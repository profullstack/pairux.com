import { describe, expect, it } from 'vitest';
import {
  EditPlanError,
  compileEdit,
  createProgressParser,
  cutRange,
  escapeDrawtext,
  formatTime,
  mergeRanges,
  parseLinkOutput,
  parseProbe,
  parsePutOutput,
  parseRange,
  parseTime,
  validatePlan,
  type MediaInfo,
} from './index.js';

const info: MediaInfo = { duration: 3600, width: 1920, height: 1080, hasVideo: true, hasAudio: true };

describe('parseTime / parseRange / formatTime', () => {
  it('reads the ways people type times', () => {
    expect(parseTime('750')).toBe(750);
    expect(parseTime('12:30')).toBe(750);
    expect(parseTime('1:02:03.5')).toBe(3723.5);
    expect(parseTime('12m30s')).toBe(750);
    expect(parseTime('1h2m')).toBe(3720);
    expect(() => parseTime('12:75')).toThrow();
    expect(() => parseTime('soon')).toThrow();
  });
  it('reads ranges', () => {
    expect(parseRange('12:30-17:30')).toEqual({ start: 750, end: 1050 });
    expect(parseRange('40m..45m')).toEqual({ start: 2400, end: 2700 });
    expect(() => parseRange('17:30-12:30')).toThrow();
  });
  it('formats', () => {
    expect(formatTime(754.2)).toBe('12:34.2');
    expect(formatTime(3723, 0)).toBe('1:02:03');
  });
});

describe('validatePlan', () => {
  it('merges overlapping ranges and clamps to the source', () => {
    const plan = validatePlan(
      { keep: [{ start: 50, end: 70 }, { start: 10, end: 20 }, { start: 15, end: 30 }, { start: 3590, end: 4000 }] },
      3600
    );
    expect(plan.keep).toEqual([
      { start: 10, end: 30 },
      { start: 50, end: 70 },
      { start: 3590, end: 3600 },
    ]);
    expect(plan.output?.format).toBe('mp4');
  });
  it('rejects bad input', () => {
    expect(() => validatePlan({ keep: [] })).toThrow(EditPlanError);
    expect(() => validatePlan({ keep: [{ start: 5, end: 5 }] })).toThrow(EditPlanError);
    expect(() => validatePlan({ keep: [{ start: 0, end: 4 }], fadeIn: 3, fadeOut: 3 })).toThrow(/fades/);
    expect(() => validatePlan({ keep: [{ start: 0, end: 10 }], fadeIn: 99 })).toThrow();
    expect(() =>
      validatePlan({ keep: [{ start: 0, end: 10 }], intro: { kind: 'title', text: 'x', duration: 3, color: 'red' } })
    ).toThrow(/colour/);
    expect(() => validatePlan({ keep: [{ start: 0, end: 10 }], intro: { kind: 'nope' } })).toThrow();
  });
  it('fills title defaults', () => {
    const plan = validatePlan({
      keep: [{ start: 0, end: 10 }],
      intro: { kind: 'title', text: '  Demo  ', duration: 3, fadeIn: 1 },
    });
    expect(plan.intro).toMatchObject({ kind: 'title', text: 'Demo', background: '#0b0b10', fadeOut: 0 });
  });
});

describe('range helpers', () => {
  it('cuts a hole out of a range', () => {
    expect(cutRange([{ start: 0, end: 100 }], 40, 60)).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
    expect(cutRange([{ start: 0, end: 100 }], 0, 100)).toEqual([]);
  });
  it('merges touching ranges', () => {
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
  });
});

describe('compileEdit', () => {
  it('seeks each kept range as its own input and concatenates', () => {
    const plan = validatePlan({ keep: [{ start: 2400, end: 2700 }, { start: 3000, end: 3010 }], fadeIn: 1, fadeOut: 2 });
    const c = compileEdit(plan, { source: 'in.webm', sourceInfo: info, output: 'out.mp4' });
    expect(c.duration).toBe(310);
    const a = c.args.join(' ');
    expect(a).toContain('-ss 2400 -t 300 -i in.webm');
    expect(a).toContain('-ss 3000 -t 10 -i in.webm');
    expect(a).toContain('concat=n=2:v=1:a=1[mcv][mca]');
    expect(a).toContain('fade=t=out:st=308:d=2');
    expect(a).toContain('afade=t=in:st=0:d=1');
    expect(a).toContain('libx264');
    expect(c.args.at(-1)).toBe('out.mp4');
    expect(c.width).toBe(1920);
  });
  it('makes silence when the source has no audio, and builds title cards', () => {
    const plan = validatePlan({
      keep: [{ start: 0, end: 60 }],
      intro: { kind: 'title', text: "Ship it: v1, [beta]; it's out", subtitle: 'PairUX', duration: 3, fadeIn: 0.5, fadeOut: 0.5 },
      outro: { kind: 'image', source: 'end.png', duration: 4 },
    });
    const c = compileEdit(plan, { source: 's.webm', sourceInfo: { ...info, hasAudio: false }, output: 'o.webm' });
    expect(c.duration).toBe(67);
    const graph = c.args[c.args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=60');
    expect(graph).toContain('drawtext=font=Sans');
    expect(graph).toContain('concat=n=3:v=1:a=1[outv][outa]');
    expect(c.args.join(' ')).toContain('-loop 1 -framerate 30 -t 4 -i end.png');
  });
  it('needs a known length for an audio-less clip', () => {
    const plan = validatePlan({ keep: [{ start: 0, end: 10 }], outro: { kind: 'file', source: 'x.webm' } });
    expect(() =>
      compileEdit(plan, {
        source: 's',
        sourceInfo: info,
        outroInfo: { duration: null, width: 1, height: 1, hasVideo: true, hasAudio: false },
        output: 'o.mp4',
      })
    ).toThrow(/length/);
  });
});

describe('escapeDrawtext', () => {
  it('escapes option and graph levels', () => {
    expect(escapeDrawtext('a:b')).toBe('a\\\\:b');
    expect(escapeDrawtext('x,y;[z]')).toBe('x\\,y\\;\\[z\\]');
    expect(escapeDrawtext("it's")).toBe('it’s');
  });
});

describe('parseProbe', () => {
  it('reads an MP4 banner', () => {
    const s = `Input #0, mov,mp4, from 'a.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo`;
    expect(parseProbe(s)).toEqual({ duration: 62.5, width: 1920, height: 1080, hasVideo: true, hasAudio: true });
  });
  it('handles MediaRecorder WebM with no duration', () => {
    const s = `Input #0, matroska,webm, from 'r.webm':
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Video: vp8, yuv420p(progressive), 2560x1440, SAR 1:1 DAR 16:9, 1k tbr`;
    expect(parseProbe(s)).toMatchObject({ duration: null, width: 2560, hasAudio: false });
  });
});

describe('progress', () => {
  it('reports fraction and completion', () => {
    const seen: number[] = [];
    let done = false;
    const feed = createProgressParser(10, (p) => {
      if (p.fraction !== null) seen.push(p.fraction);
      done ||= p.done;
    });
    feed('out_time_us=5000000\nprogress=cont');
    feed('inue\nout_time_us=10000000\nprogress=end\n');
    expect(seen).toEqual([0.5, 1]);
    expect(done).toBe(true);
  });
});

describe('c0mpute output', () => {
  it('finds the ref and the link', () => {
    expect(parsePutOutput('uploading\nc0p1:0123456789abcdef0123\n')).toBe('c0p1:0123456789abcdef0123');
    expect(parsePutOutput('nothing')).toBeNull();
    expect(
      parseLinkOutput(
        'https://gateway.c0mpute.com/p/abc123/#k=KEYKEY\nc0p1:0123456789abcdef0123#k=KEYKEY\n'
      )
    ).toEqual({
      link: 'https://gateway.c0mpute.com/p/abc123/#k=KEYKEY',
      capability: 'c0p1:0123456789abcdef0123#k=KEYKEY',
    });
  });
});
