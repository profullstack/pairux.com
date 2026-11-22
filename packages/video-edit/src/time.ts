/**
 * Timecodes as people type them: `750`, `12:30`, `1:02:03.5`, `12m30s`, `1h2m`.
 */

import type { KeepRange } from './plan.js';

export function parseTime(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) throw new Error('Empty time');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const units = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (units && (units[1] ?? units[2] ?? units[3]) !== undefined) {
    return (
      Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
    );
  }
  const parts = s.split(':');
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    const nums = parts.map(Number);
    const [h, m, sec] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
    if ((m ?? 0) >= 60 && nums.length === 3) throw new Error(`Bad time: ${input}`);
    if ((sec ?? 0) >= 60) throw new Error(`Bad time: ${input}`);
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0);
  }
  throw new Error(`Bad time: ${input}`);
}

/** `12:30-17:30` (or `12:30..17:30`) to a keep range. */
export function parseRange(input: string): KeepRange {
  const m = /^\s*([^-.]+(?:\.\d+)?)\s*(?:-|\.\.)\s*(.+?)\s*$/.exec(input);
  if (!m?.[1] || !m[2]) throw new Error(`Bad range (want start-end): ${input}`);
  const start = parseTime(m[1]);
  const end = parseTime(m[2]);
  if (end <= start) throw new Error(`Range ends before it starts: ${input}`);
  return { start, end };
}

/** 754.25 -> "12:34.2"; 3723 -> "1:02:03". */
export function formatTime(seconds: number, decimals = 1): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const sec = decimals > 0 ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${sec}` : `${String(m)}:${sec}`;
}
