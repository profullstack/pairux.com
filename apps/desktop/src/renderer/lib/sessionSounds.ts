/**
 * Sounds for someone arriving in or leaving a session.
 *
 * These are synthesised rather than sampled. A convincing door recording would
 * mean shipping licensed binary assets and wiring them into two bundlers, and a
 * door synthesised from oscillators sounds cheap. A short two-note figure
 * carries the same meaning and is what every other call app converged on: the
 * interval rises when someone arrives and falls when they leave, so the two are
 * distinguishable without looking at the screen — and even without recognising
 * which sound is which, direction alone tells you what happened.
 *
 * Both are deliberately quiet. This fires while people are mid-conversation.
 */

import { useEffect, useState } from 'react';
import { getAudioContext, resumeAudioContext } from './audioContext';

const SETTINGS_KEY = 'pairux-settings';

/** Dispatched on `window` whenever the toggle changes within this window. */
export const SESSION_SOUNDS_CHANGED_EVENT = 'pairux-session-sounds-changed';

interface PersistedSettings {
  session?: { joinLeaveSounds?: boolean };
}

/**
 * Read the current value synchronously from localStorage. Defaults to ON.
 *
 * Unlike going live to a streaming service, a quiet chime is not a surprising
 * thing for a call app to do, and not hearing that someone joined is worse than
 * hearing that they did.
 */
export function areSessionSoundsEnabled(): boolean {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return true;
  const parsed = JSON.parse(raw) as PersistedSettings;
  return parsed.session?.joinLeaveSounds !== false;
}

/**
 * Reactive view of the toggle. Updates when the Settings page changes it (same
 * window via {@link SESSION_SOUNDS_CHANGED_EVENT}, or another via `storage`).
 */
export function useSessionSoundsEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => areSessionSoundsEnabled());

  useEffect(() => {
    const sync = (): void => {
      setEnabled(areSessionSoundsEnabled());
    };
    window.addEventListener(SESSION_SOUNDS_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SESSION_SOUNDS_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return enabled;
}

/** Peak amplitude of a single note. A notification, not an alarm. */
const NOTE_PEAK_GAIN = 0.18;
/** How long one note rings, in seconds. */
const NOTE_DURATION = 0.2;
/** Gap between the two notes. Short enough to read as one gesture. */
const NOTE_SPACING = 0.09;

/** C5 and G5 — a perfect fifth, which is consonant in either direction. */
const LOW_NOTE_HZ = 523.25;
const HIGH_NOTE_HZ = 783.99;

/**
 * Schedule one note.
 *
 * The decay is exponential because a linear fade to silence sounds like it is
 * being cut off, and `exponentialRampToValueAtTime` cannot reach exactly zero —
 * hence ramping to a near-zero floor and stopping the oscillator after.
 */
function scheduleNote(ctx: AudioContext, frequency: number, startTime: number): void {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, startTime);
  // A few milliseconds of attack: stepping straight to peak is an audible click.
  envelope.gain.linearRampToValueAtTime(NOTE_PEAK_GAIN, startTime + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + NOTE_DURATION);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + NOTE_DURATION);
}

/** Play a two-note figure in the given order. */
function playFigure(frequencies: readonly [number, number]): void {
  const ctx = getAudioContext();
  resumeAudioContext(ctx);

  // Schedule slightly ahead of `currentTime`: scheduling exactly at it races
  // the audio thread and can drop the attack.
  const startTime = ctx.currentTime + 0.02;
  scheduleNote(ctx, frequencies[0], startTime);
  scheduleNote(ctx, frequencies[1], startTime + NOTE_SPACING);
}

/** Someone joined — the figure rises. */
export function playJoinSound(): void {
  playFigure([LOW_NOTE_HZ, HIGH_NOTE_HZ]);
}

/** Someone left — the figure falls. */
export function playLeaveSound(): void {
  playFigure([HIGH_NOTE_HZ, LOW_NOTE_HZ]);
}
