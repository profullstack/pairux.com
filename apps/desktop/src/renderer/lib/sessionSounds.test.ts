import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  areSessionSoundsEnabled,
  playJoinSound,
  playLeaveSound,
  SESSION_SOUNDS_CHANGED_EVENT,
} from './sessionSounds';
import { getAudioContext } from './audioContext';

const SETTINGS_KEY = 'pairux-settings';

/** Frequencies handed to each oscillator, in the order they were scheduled. */
function scheduledFrequencies(): number[] {
  const ctx = getAudioContext() as unknown as {
    createdOscillators: { frequency: { value: number }; startTime: number }[];
  };
  return ctx.createdOscillators.map((osc) => osc.frequency.value);
}

function scheduledStartTimes(): number[] {
  const ctx = getAudioContext() as unknown as {
    createdOscillators: { startTime: number }[];
  };
  return ctx.createdOscillators.map((osc) => osc.startTime);
}

function resetOscillators(): void {
  const ctx = getAudioContext() as unknown as { createdOscillators: unknown[] };
  ctx.createdOscillators.length = 0;
}

beforeEach(() => {
  localStorage.clear();
  resetOscillators();
});

afterEach(() => {
  localStorage.clear();
});

describe('areSessionSoundsEnabled', () => {
  it('defaults to on when nothing has been saved', () => {
    expect(areSessionSoundsEnabled()).toBe(true);
  });

  it('defaults to on when other settings exist but this one does not', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ session: { allowControl: true } }));
    expect(areSessionSoundsEnabled()).toBe(true);
  });

  it('is off only when explicitly disabled', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ session: { joinLeaveSounds: false } }));
    expect(areSessionSoundsEnabled()).toBe(false);
  });

  it('is on when explicitly enabled', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ session: { joinLeaveSounds: true } }));
    expect(areSessionSoundsEnabled()).toBe(true);
  });
});

describe('join and leave sounds', () => {
  it('plays two notes for a join', () => {
    playJoinSound();
    expect(scheduledFrequencies()).toHaveLength(2);
  });

  it('rises for a join and falls for a leave', () => {
    playJoinSound();
    const join = scheduledFrequencies();
    expect(join).toEqual([...join].sort((a, b) => a - b));

    resetOscillators();

    playLeaveSound();
    const leave = scheduledFrequencies();
    expect(leave).toEqual([...leave].sort((a, b) => b - a));
  });

  it('uses the same two pitches for both, so only direction differs', () => {
    playJoinSound();
    const join = [...scheduledFrequencies()].sort();
    resetOscillators();
    playLeaveSound();
    const leave = [...scheduledFrequencies()].sort();
    expect(join).toEqual(leave);
  });

  it('separates the notes in time rather than stacking them into a chord', () => {
    playJoinSound();
    const times = scheduledStartTimes();
    expect(new Set(times).size).toBe(2);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('schedules ahead of the clock so the attack is not clipped', () => {
    playJoinSound();
    const ctx = getAudioContext();
    expect(Math.min(...scheduledStartTimes())).toBeGreaterThan(ctx.currentTime);
  });
});

describe('SESSION_SOUNDS_CHANGED_EVENT', () => {
  it('is namespaced so it cannot collide with another app event', () => {
    expect(SESSION_SOUNDS_CHANGED_EVENT).toContain('pairux');
  });
});
