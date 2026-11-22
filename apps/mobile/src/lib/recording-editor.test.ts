import { describe, expect, it } from 'vitest';
import {
  anyProcessing,
  buildPlan,
  clampFade,
  cutSelection,
  desktopEditLink,
  webPublishUrl,
  formatBytes,
  initialEditorState,
  keepSelection,
  outputDuration,
  positionToTime,
  rangeGeometry,
  removeRange,
  selectionRange,
} from './recording-editor';
import type { Recording } from './api/recordings';

describe('selections', () => {
  it('orders in/out and ignores incomplete or empty selections', () => {
    expect(selectionRange({ in: 50, out: 20 })).toEqual({ start: 20, end: 50 });
    expect(selectionRange({ in: 5, out: null })).toBeNull();
    expect(selectionRange({ in: 5, out: 5 })).toBeNull();
  });
  it('keeps and merges', () => {
    const k = keepSelection([{ start: 0, end: 10 }], { in: 5, out: 20 });
    expect(k).toEqual([{ start: 0, end: 20 }]);
    expect(removeRange(k, 0)).toEqual([]);
  });
  it('cuts from everything when nothing is kept yet', () => {
    expect(cutSelection([], { in: 40, out: 60 }, 100)).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
    expect(cutSelection([], { in: 40, out: 60 }, null)).toEqual([]);
  });
});

describe('timeline math', () => {
  it('maps ranges and touches', () => {
    expect(rangeGeometry({ start: 25, end: 50 }, 100)).toEqual({ left: 0.25, width: 0.25 });
    expect(rangeGeometry({ start: 25, end: 50 }, 0)).toEqual({ left: 0, width: 0 });
    expect(positionToTime(150, 300, 60)).toBe(30);
    expect(positionToTime(-5, 300, 60)).toBe(0);
    expect(positionToTime(999, 300, 60)).toBe(60);
  });
  it('clamps fades to half seconds within 0-5', () => {
    expect(clampFade(7)).toBe(5);
    expect(clampFade(-1)).toBe(0);
    expect(clampFade(1.3)).toBe(1.5);
  });
});

describe('buildPlan', () => {
  it('keeps the whole recording when no range is chosen', () => {
    const plan = buildPlan({ ...initialEditorState(), fadeIn: 1 }, 120);
    expect(plan.keep).toEqual([{ start: 0, end: 120 }]);
    expect(plan.fadeIn).toBe(1);
  });
  it('maps bumpers', () => {
    const plan = buildPlan(
      {
        ...initialEditorState(),
        keep: [{ start: 10, end: 70 }],
        intro: { kind: 'title', text: 'Demo', subtitle: '', duration: 3 },
        outro: { kind: 'recording', recordingId: 'abc' },
      },
      120
    );
    expect(plan.intro).toMatchObject({ kind: 'title', text: 'Demo', duration: 3 });
    expect(plan.outro).toMatchObject({ kind: 'file', source: 'recording:abc' });
    expect(
      outputDuration(
        {
          ...initialEditorState(),
          keep: [{ start: 10, end: 70 }],
          intro: { kind: 'title', text: 'x', subtitle: '', duration: 3 },
        },
        120
      )
    ).toBe(63);
  });
  it('throws a readable error for an empty title', () => {
    expect(() =>
      buildPlan(
        { ...initialEditorState(), intro: { kind: 'title', text: ' ', subtitle: '', duration: 3 } },
        60
      )
    ).toThrow(/text/);
  });
});

describe('misc', () => {
  it('points publishing at the pairux.com page', () => {
    expect(webPublishUrl('https://pairux.com/', 'r 1')).toBe(
      'https://pairux.com/recordings/r%201/publish'
    );
  });
  it('builds the desktop deep link', () => {
    expect(desktopEditLink('https://x.test/a b.mp4', 'My cut')).toBe(
      'pairux://edit?url=https%3A%2F%2Fx.test%2Fa%20b.mp4&title=My%20cut'
    );
  });
  it('detects processing rows and formats bytes', () => {
    const r = { status: 'processing' } as Recording;
    expect(anyProcessing([r])).toBe(true);
    expect(anyProcessing([{ ...r, status: 'ready' }])).toBe(false);
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(null)).toBe('');
  });
});
