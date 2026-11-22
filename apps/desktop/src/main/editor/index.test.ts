import { execFileSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EditorService,
  cacheKey,
  defaultOutputPath,
  findTitleFont,
  listVideoFiles,
  pruneCache,
} from './index';

function systemFfmpeg(): string | null {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

describe('editor helpers', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pairux-editor-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists video files newest first and skips everything else', () => {
    writeFileSync(join(dir, 'old.webm'), 'x');
    writeFileSync(join(dir, 'new.mp4'), 'xx');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'empty.webm'), '');
    utimesSync(join(dir, 'old.webm'), new Date(1000), new Date(1000));
    const files = listVideoFiles(dir);
    expect(files.map((f) => f.name)).toEqual(['new.mp4', 'old.webm']);
    expect(listVideoFiles(join(dir, 'missing'))).toEqual([]);
  });

  it('keys the cache on path, size and mtime', () => {
    expect(cacheKey('/a.webm', 10, 5)).toBe(cacheKey('/a.webm', 10, 5.4));
    expect(cacheKey('/a.webm', 10, 5)).not.toBe(cacheKey('/a.webm', 11, 5));
    expect(cacheKey('/a.webm', 10, 5)).toHaveLength(24);
  });

  it('prunes old and surplus cache files', () => {
    const cache = join(dir, 'cache');
    mkdirSync(cache);
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const p = join(cache, `${String(i)}.webm`);
      writeFileSync(p, 'x');
      const t = new Date(now - i * 1000);
      utimesSync(p, t, t);
    }
    const stale = join(cache, 'stale.webm');
    writeFileSync(stale, 'x');
    utimesSync(stale, new Date(now - 30 * 864e5), new Date(now - 30 * 864e5));
    pruneCache(cache, 2, 7 * 864e5, now);
    expect(readdirSync(cache).sort()).toEqual(['0.webm', '1.webm']);
  });

  it('names exports after the source without stacking -edit- suffixes', () => {
    const now = new Date('2026-11-22T10:20:30.000Z');
    expect(defaultOutputPath('/r/PairUX-Recording-x.webm', '/out', 'mp4', now)).toBe(
      join('/out', 'PairUX-Recording-x-edit-2026-11-22T10-20-30.mp4')
    );
    expect(defaultOutputPath('/r/talk-edit-2026-11-21T09-00-00.mp4', '/out', 'webm', now)).toBe(
      join('/out', 'talk-edit-2026-11-22T10-20-30.webm')
    );
  });

  it('finds a title font per platform', () => {
    expect(findTitleFont('darwin', (p) => p === '/System/Library/Fonts/Helvetica.ttc')).toBe(
      '/System/Library/Fonts/Helvetica.ttc'
    );
    expect(
      findTitleFont(
        'linux',
        (p) => p === '/f/Bold.ttf',
        () => '/f/Bold.ttf'
      )
    ).toBe('/f/Bold.ttf');
    expect(
      findTitleFont(
        'linux',
        (p) => p === '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        () => null
      )
    ).toBe('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    expect(
      findTitleFont(
        'linux',
        () => false,
        () => null
      )
    ).toBeNull();
  });
});

const ff = systemFfmpeg();

describe.skipIf(!ff)('EditorService with real ffmpeg', () => {
  let dir: string;
  let source: string;
  let service: EditorService;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pairux-editor-ff-'));
    source = join(dir, 'rec.webm');
    // Piped through stdout, ffmpeg cannot seek back to write a duration or
    // cues: the same shape MediaRecorder produces.
    const webm = execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=320x240:r=15:d=8',
        '-f',
        'lavfi',
        '-i',
        'sine=f=440:d=8',
        '-c:v',
        'libvpx',
        '-deadline',
        'realtime',
        '-cpu-used',
        '8',
        '-c:a',
        'libopus',
        '-f',
        'webm',
        '-',
      ],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    writeFileSync(source, webm);
    service = new EditorService({
      ffmpegPath: () => ff,
      cacheDir: () => join(dir, 'cache'),
      outputDir: () => join(dir, 'out'),
      font: () => null,
    });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('remuxes a duration-less WebM so it can be scrubbed, then exports a trim', async () => {
    const opened = await service.open(source);
    expect(opened.sourcePath).toBe(source);
    expect(opened.info.hasAudio).toBe(true);
    expect(opened.info.duration).toBeGreaterThan(7);

    const fractions: number[] = [];
    const result = await service.render(
      {
        keep: [{ start: 2, end: 5 }],
        fadeIn: 0.5,
        fadeOut: 0.5,
        intro: { kind: 'title', text: 'Hi: there', duration: 1 },
      },
      {
        source: opened.editPath,
        sourcePath: source,
        quality: 'fast',
        sourceDuration: opened.info.duration,
      },
      (p) => {
        if (p.fraction !== null) fractions.push(p.fraction);
      }
    );
    expect(result.output.startsWith(join(dir, 'out'))).toBe(true);
    expect(existsSync(result.output)).toBe(true);
    expect(result.duration).toBe(4);
    expect(fractions.at(-1)).toBe(1);
    const info = await service.probe(result.output);
    expect(info.duration).toBeGreaterThan(3.8);
    expect(info.duration).toBeLessThan(4.3);
  }, 60_000);

  it('refuses to overwrite the recording and to run two exports at once', async () => {
    await expect(
      service.render({ keep: [{ start: 0, end: 1 }] }, { source, output: source }, () => undefined)
    ).rejects.toThrow(/overwrite/);
    const first = service.render({ keep: [{ start: 0, end: 6 }] }, { source }, () => undefined);
    await expect(
      service.render({ keep: [{ start: 0, end: 1 }] }, { source }, () => undefined)
    ).rejects.toThrow(/already running/);
    expect(service.cancelRender()).toBe(true);
    await expect(first).rejects.toThrow(/Cancelled/);
    expect(service.rendering).toBe(false);
  }, 60_000);
});
