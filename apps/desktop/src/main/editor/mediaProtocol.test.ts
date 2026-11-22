import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

import {
  allowMediaPath,
  mediaResponse,
  mediaUrlFor,
  parseRangeHeader,
  pathFromMediaUrl,
} from './mediaProtocol';

describe('parseRangeHeader', () => {
  it('reads open, closed and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRangeHeader('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRangeHeader('bytes=100-', 100)).toBeNull();
    expect(parseRangeHeader('bytes=5-1', 100)).toBeNull();
    expect(parseRangeHeader('items=0-1', 100)).toBeNull();
    expect(parseRangeHeader(null, 100)).toBeNull();
  });
});

describe('mediaResponse', () => {
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pairux-media-'));
    file = join(dir, 'clip.webm');
    writeFileSync(file, Buffer.from('0123456789'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips paths through the URL', () => {
    expect(pathFromMediaUrl(mediaUrlFor(file))).toBe(file);
    expect(pathFromMediaUrl('https://example.com/x')).toBeNull();
  });

  it('refuses files the editor has not opened', async () => {
    const other = join(dir, 'secret.webm');
    writeFileSync(other, 'nope');
    const res = mediaResponse(mediaUrlFor(other), null);
    expect(res.status).toBe(404);
    expect(mediaResponse(mediaUrlFor('/etc/passwd'), null).status).toBe(404);
    await res.body?.cancel();
  });

  it('serves whole files and byte ranges once allowed', async () => {
    const url = allowMediaPath(file);
    const whole = mediaResponse(url, null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/webm');
    expect(await whole.text()).toBe('0123456789');

    const part = mediaResponse(url, 'bytes=2-5');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');

    expect(mediaResponse(url, 'bytes=50-').status).toBe(416);
  });
});
