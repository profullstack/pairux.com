/**
 * `pairux-media://` — how the editor's <video> plays local recordings.
 *
 * The renderer runs with webSecurity on (and from http://localhost in dev), so
 * it cannot load file:// URLs. This privileged scheme streams a file with HTTP
 * Range support so the timeline can seek. It serves only files the editor has
 * explicitly opened in this run (allowMediaPath), never an arbitrary path a
 * compromised page asks for.
 */

import { protocol } from 'electron';
import { createReadStream, statSync } from 'fs';
import { extname, resolve } from 'path';
import { Readable } from 'stream';

export const MEDIA_SCHEME = 'pairux-media';

const allowed = new Set<string>();

const TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Allow a file to be served and return the URL the renderer should use. */
export function allowMediaPath(path: string): string {
  const abs = resolve(path);
  allowed.add(abs);
  return mediaUrlFor(abs);
}

export function mediaUrlFor(path: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(resolve(path))}`;
}

export function pathFromMediaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== `${MEDIA_SCHEME}:` || u.host !== 'file') return null;
    return resolve(decodeURIComponent(u.pathname.replace(/^\//, '')));
  } catch {
    return null;
  }
}

export function isMediaPathAllowed(path: string): boolean {
  return allowed.has(resolve(path));
}

/** Parse a single `bytes=a-b` range against a file size. */
export function parseRangeHeader(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] !== '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || start > end || start >= size) return null;
  return { start, end };
}

/** Build the response for a media request. Exported for tests. */
export function mediaResponse(url: string, rangeHeader: string | null): Response {
  const path = pathFromMediaUrl(url);
  if (!path || !isMediaPathAllowed(path)) return new Response('Not found', { status: 404 });
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = parseRangeHeader(rangeHeader, size);
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${String(size)}` },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const body =
    size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size === 0 ? 0 : end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(range
        ? { 'Content-Range': `bytes ${String(start)}-${String(end)}/${String(size)}` }
        : {}),
    },
  });
}

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ]);
}

/** Run after 'ready'. */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) =>
    mediaResponse(request.url, request.headers.get('range'))
  );
}
