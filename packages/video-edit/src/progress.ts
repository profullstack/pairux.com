/**
 * Follow `ffmpeg -progress pipe:1` output. It prints blocks of key=value lines,
 * each ending in `progress=continue` or `progress=end`; out_time_us (and the
 * misnamed out_time_ms, also microseconds) is how far the output has got.
 */

export interface ProgressUpdate {
  /** Seconds of output written. */
  seconds: number;
  /** 0-1, when the total is known. */
  fraction: number | null;
  done: boolean;
}

export function createProgressParser(
  totalSeconds: number | null,
  onUpdate: (update: ProgressUpdate) => void
): (chunk: string) => void {
  let buffer = '';
  let seconds = 0;
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'out_time_us' || key === 'out_time_ms') {
        const us = Number(value);
        if (Number.isFinite(us) && us >= 0) seconds = us / 1_000_000;
      } else if (key === 'progress') {
        const done = value === 'end';
        const fraction =
          totalSeconds && totalSeconds > 0
            ? done
              ? 1
              : Math.min(0.999, seconds / totalSeconds)
            : null;
        onUpdate({ seconds, fraction, done });
      }
    }
  };
}
