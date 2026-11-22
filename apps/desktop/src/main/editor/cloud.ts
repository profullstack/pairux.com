/**
 * Bring a cloud recording down for editing.
 *
 * The web and mobile apps send `pairux://edit?url=<playback url>&title=<t>`
 * so a recording made on the SFU can be trimmed here and, from here,
 * published to c0mpute private storage (which only works where the c0mpute
 * binary runs). The URL comes from outside the app, so only https on hosts
 * PairUX serves recordings from is accepted, and it is checked again in main
 * before anything is fetched.
 */

import { createWriteStream, existsSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { API_BASE_URL } from '../../shared/config';

/** Hosts recordings are served from besides pairux.com and its subdomains. */
const EXTRA_HOSTS = new Set([
  // The Supabase project recordings were stored in before the move to dev2.
  'yuwjbjskkghlyrdkhexu.supabase.co',
]);

function apiHost(): string | null {
  try {
    return new URL(API_BASE_URL).host;
  } catch {
    return null;
  }
}

export function isAllowedCloudUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'pairux.com' || host.endsWith('.pairux.com')) return true;
  if (EXTRA_HOSTS.has(host)) return true;
  return host === apiHost();
}

/** A filesystem-safe base name from a recording title. */
export function safeFilename(
  title: string | null | undefined,
  fallback = 'PairUX-Cloud-Recording'
): string {
  const cleaned = (title ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function extFromUrl(url: string): string {
  const m = /\.(mp4|webm|mkv|mov|m4v)$/i.exec(new URL(url).pathname);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
}

export async function downloadCloudRecording(
  url: string,
  title: string | null,
  dir: string,
  opts: {
    fetchImpl?: typeof fetch;
    onProgress?: (received: number, total: number | null) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string> {
  if (!isAllowedCloudUrl(url)) throw new Error('That link is not a PairUX recording');
  const res = await (opts.fetchImpl ?? fetch)(url, { signal: opts.signal, redirect: 'error' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${String(res.status)})`);
  const total = Number(res.headers.get('content-length')) || null;
  const base = safeFilename(title);
  const ext = extFromUrl(url);
  let target = join(dir, `${base}${ext}`);
  for (let i = 2; existsSync(target); i++) target = join(dir, `${base}-${String(i)}${ext}`);
  const partial = `${target}.partial`;
  let received = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    opts.onProgress?.(received, total);
  });
  try {
    await pipeline(body, createWriteStream(partial));
    renameSync(partial, target);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // Nothing written.
    }
    throw error;
  }
  return target;
}
