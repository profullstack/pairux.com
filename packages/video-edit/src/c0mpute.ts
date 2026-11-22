/**
 * Publishing to c0mpute private storage (DIP-0012, `c0mpute-private-v1`).
 *
 * The file is encrypted on this machine by the user's own `c0mpute` binary
 * under their own identity (AES-256-GCM, data key wrapped to the reader's
 * X25519 key), then published to the network. PairUX never sees the key: it
 * runs `c0mpute storage put`, reads the `c0p1:` reference from stdout, and
 * asks `c0mpute storage link` for the browser URL with the key in its `#k=`
 * fragment. There is no HTTP API for private storage, so this only works
 * where the binary runs: the desktop app and `pairux edit`.
 */

export interface C0mputePublishResult {
  /** Owner reference, `c0p1:<id>`. Only the owner (and shared readers) can open it. */
  ref: string;
  /** Browser link with the key in the fragment, when `storage link` gave one. */
  link: string | null;
  /** Capability reference `c0p1:<id>#k=<key>`, for `c0mpute storage get`. */
  capability: string | null;
}

/** Largest object the browser loader opens; bigger ones need `c0mpute storage get`. */
export const C0MPUTE_BROWSER_LIMIT = 192 * 1024 * 1024;

const REF = /\bc0p1:[0-9a-f]{20}\b(?!#)/i;

export function parsePutOutput(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const m = REF.exec(line.trim());
    if (m) return m[0];
  }
  return null;
}

export function parseLinkOutput(stdout: string): { link: string | null; capability: string | null } {
  const link = /https:\/\/\S+\/p\/[0-9a-z]+\/?#k=\S+/i.exec(stdout)?.[0] ?? null;
  const capability = /\bc0p1:[0-9a-f]{20}#k=\S+/i.exec(stdout)?.[0] ?? null;
  return { link, capability };
}

export function c0mputePutArgs(file: string, shareWith: string[] = []): string[] {
  return ['storage', 'put', file, ...shareWith.flatMap((r) => ['--with', r])];
}

export function c0mputeLinkArgs(ref: string): string[] {
  return ['storage', 'link', ref];
}

/** Where installers put the binary, after $PATH. */
export function c0mputeCandidates(home: string, platform: NodeJS.Platform | string): string[] {
  const exe = platform === 'win32' ? 'c0mpute.exe' : 'c0mpute';
  const sep = platform === 'win32' ? '\\' : '/';
  return [
    [home, '.local', 'bin', exe].join(sep),
    [home, '.cargo', 'bin', exe].join(sep),
    ...(platform === 'win32' ? [] : ['/usr/local/bin/c0mpute', '/opt/homebrew/bin/c0mpute', '/usr/bin/c0mpute']),
  ];
}
