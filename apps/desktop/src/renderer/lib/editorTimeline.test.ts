import { describe, expect, it } from 'vitest';
import { validatePlan } from '@pairux/video-edit';
import {
  addToKept,
  applyOutMark,
  buildPlan,
  bumperToPlan,
  cutSelection,
  emptyBumper,
  formatBytes,
  isWholeRecording,
  marksToSelection,
  previewPosition,
  removeSegment,
  segmentAt,
} from './editorTimeline';

describe('marks', () => {
  it('orders marks and ignores empty selections', () => {
    expect(marksToSelection(30, 10)).toEqual({ start: 10, end: 30 });
    expect(marksToSelection(5, 5.05)).toBeNull();
    expect(marksToSelection(null, 5)).toBeNull();
  });

  it('first out mark keeps only the selection, later ones add to it', () => {
    const whole = [{ start: 0, end: 3600 }];
    expect(isWholeRecording(whole, 3600)).toBe(true);
    const first = applyOutMark(whole, 3600, { start: 2400, end: 2700 });
    expect(first).toEqual([{ start: 2400, end: 2700 }]);
    const second = applyOutMark(first, 3600, { start: 100, end: 160 });
    expect(second).toEqual([
      { start: 100, end: 160 },
      { start: 2400, end: 2700 },
    ]);
  });

  it('cuts, adds and removes segments', () => {
    const keep = [{ start: 0, end: 100 }];
    const cut = cutSelection(keep, { start: 40, end: 60 });
    expect(cut).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
    expect(addToKept(cut, { start: 35, end: 65 })).toEqual([{ start: 0, end: 100 }]);
    expect(removeSegment(cut, 0)).toEqual([{ start: 60, end: 100 }]);
    expect(segmentAt(cut, 70)).toBe(1);
    expect(segmentAt(cut, 50)).toBe(-1);
  });
});

describe('previewPosition', () => {
  const keep = [
    { start: 60, end: 70 },
    { start: 10, end: 20 },
  ];
  it('plays inside ranges, jumps gaps, stops at the end', () => {
    expect(previewPosition(keep, 0)).toBe(10);
    expect(previewPosition(keep, 15)).toBe(15);
    expect(previewPosition(keep, 20)).toBe(60);
    expect(previewPosition(keep, 69.99)).toBeNull();
    expect(previewPosition(keep, 80)).toBeNull();
  });
});

describe('plan building', () => {
  it('drops unfinished bumpers and scales fades that do not fit the card', () => {
    expect(bumperToPlan({ ...emptyBumper(''), mode: 'title' })).toBeNull();
    expect(bumperToPlan({ ...emptyBumper(''), mode: 'file' })).toBeNull();
    const card = bumperToPlan({
      ...emptyBumper('Hello'),
      mode: 'title',
      duration: 1,
      fadeIn: 1,
      fadeOut: 1,
    });
    expect(card).toMatchObject({ kind: 'title', fadeIn: 0.5, fadeOut: 0.5 });
  });

  it('produces a plan the engine accepts', () => {
    const plan = buildPlan({
      keep: [{ start: 2400, end: 2700 }],
      fadeIn: 1,
      fadeOut: 1,
      intro: { ...emptyBumper('Demo'), mode: 'title' },
      outro: { ...emptyBumper('Bye'), mode: 'image', source: '/tmp/end.png' },
      format: 'mp4',
    });
    const valid = validatePlan(plan, 3600);
    expect(valid.intro).toMatchObject({ kind: 'title', text: 'Demo' });
    expect(valid.outro).toMatchObject({ kind: 'image', source: '/tmp/end.png' });
  });

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});
