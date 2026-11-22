import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadCloudRecording, isAllowedCloudUrl, safeFilename } from './cloud';

describe('isAllowedCloudUrl', () => {
  it('accepts https on PairUX hosts only', () => {
    expect(
      isAllowedCloudUrl('https://supabase.pairux.com/storage/v1/object/public/recordings/a/b.mp4')
    ).toBe(true);
    expect(isAllowedCloudUrl('https://pairux.com/r.mp4')).toBe(true);
    expect(
      isAllowedCloudUrl(
        'https://yuwjbjskkghlyrdkhexu.supabase.co/storage/v1/object/public/recordings/x.mp4'
      )
    ).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isAllowedCloudUrl('http://supabase.pairux.com/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('https://evilpairux.com/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('https://pairux.com.evil.io/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('https://user:pw@pairux.com/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('https://pairux.com:8443/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedCloudUrl('https://other.supabase.co/x.mp4')).toBe(false);
    expect(isAllowedCloudUrl('not a url')).toBe(false);
  });
});

describe('safeFilename', () => {
  it('strips path tricks and punctuation', () => {
    expect(safeFilename('../../etc/passwd')).toBe('etcpasswd');
    expect(safeFilename('Weekly sync: Q4 / roadmap')).toBe('Weekly-sync-Q4-roadmap');
    expect(safeFilename('   ')).toBe('PairUX-Cloud-Recording');
    expect(safeFilename(null)).toBe('PairUX-Cloud-Recording');
  });
});

describe('downloadCloudRecording', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pairux-cloud-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const fakeFetch = (body: string, status = 200) =>
    (() =>
      Promise.resolve(
        new Response(body, { status, headers: { 'content-length': String(body.length) } })
      )) as unknown as typeof fetch;

  it('streams to the recordings folder without clobbering', async () => {
    const seen: number[] = [];
    const a = await downloadCloudRecording('https://supabase.pairux.com/r/x.mp4', 'Demo', dir, {
      fetchImpl: fakeFetch('hello'),
      onProgress: (r) => seen.push(r),
    });
    const b = await downloadCloudRecording('https://supabase.pairux.com/r/x.mp4', 'Demo', dir, {
      fetchImpl: fakeFetch('again'),
    });
    expect(a).toBe(join(dir, 'Demo.mp4'));
    expect(b).toBe(join(dir, 'Demo-2.mp4'));
    expect(readFileSync(b, 'utf8')).toBe('again');
    expect(seen.at(-1)).toBe(5);
  });

  it('refuses foreign hosts and leaves no partial file on failure', async () => {
    await expect(
      downloadCloudRecording('https://evil.example/x.mp4', 't', dir, { fetchImpl: fakeFetch('x') })
    ).rejects.toThrow(/not a PairUX recording/);
    await expect(
      downloadCloudRecording('https://pairux.com/x.mp4', 'Gone', dir, {
        fetchImpl: fakeFetch('', 404),
      })
    ).rejects.toThrow(/404/);
    expect(existsSync(join(dir, 'Gone.mp4'))).toBe(false);
    expect(readdirSync(dir).some((n) => n.endsWith('.partial'))).toBe(false);
  });
});
