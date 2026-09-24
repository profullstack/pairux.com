import { describe, expect, it } from 'vitest';
import { computeMetrics, countFillers, countWords, formatClock } from './metrics';
import { groupChunksByRun, chunkPath, framePath, frameTimeMs } from './store';
import { extensionFor } from './run';
import { pickEvenly } from './report';

describe('metrics', () => {
  it('counts words and multi-word fillers without double counting', () => {
    expect(countWords("I'm, like, ready")).toBe(3);
    const f = countFillers('Um, you know, I like it. Like, basically yes. You know?');
    expect(f.get('you know')).toBe(2);
    expect(f.get('um')).toBe(1);
    expect(f.get('like')).toBe(2);
    expect(f.get('basically')).toBe(1);
  });

  it('measures talk share, pace, turns, questions and interruptions per speaker', () => {
    const m = computeMetrics(
      [
        { startMs: 0, endMs: 60_000, speaker: 'A', text: 'word '.repeat(150).trim() },
        { startMs: 59_000, endMs: 79_000, speaker: 'B', text: 'Can I ask? um what next?' },
        { startMs: 80_000, endMs: 100_000, speaker: 'A', text: 'Sure.' },
      ],
      120_000
    );
    const a = m.speakers.find((s) => s.speaker === 'A')!;
    const b = m.speakers.find((s) => s.speaker === 'B')!;
    expect(a.talkShare).toBe(80);
    expect(a.wordsPerMinute).toBe(113);
    expect(b.questions).toBe(2);
    expect(b.interruptions).toBe(1);
    expect(b.fillerWords).toBe(1);
    expect(m.silenceShare).toBe(17);
    expect(m.speakers[0]?.speaker).toBe('A');
  });

  it('formats call time', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});

describe('storage layout', () => {
  it('groups chunks by recorder run, in order', () => {
    const names = [
      chunkPath('x', 2000, 1),
      chunkPath('x', 1000, 1),
      chunkPath('x', 2000, 0),
      chunkPath('x', 1000, 0),
      'x/chunks/junk.txt',
    ].map((p) => p.split('/').pop()!);
    expect(groupChunksByRun(names)).toEqual([
      ['0000000001000-000000.bin', '0000000001000-000001.bin'],
      ['0000000002000-000000.bin', '0000000002000-000001.bin'],
    ]);
  });

  it('round-trips frame times', () => {
    expect(frameTimeMs(framePath('x', 123456).split('/').pop()!)).toBe(123456);
  });

  it('maps recorder MIME types to file extensions', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
  });

  it('picks frames evenly, keeping first and last', () => {
    expect(pickEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(pickEvenly([1, 2], 12)).toEqual([1, 2]);
  });
});
