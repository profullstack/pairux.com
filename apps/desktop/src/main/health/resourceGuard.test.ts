import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyMemory,
  readSystemMemory,
  startResourceGuard,
  DEFAULT_THRESHOLDS,
  type MemorySnapshot,
} from './resourceGuard';

const MEMINFO = [
  'MemTotal:       16323216 kB',
  'MemFree:          361284 kB',
  'MemAvailable:    8216044 kB',
  'Buffers:          123456 kB',
].join('\n');

describe('readSystemMemory', () => {
  it('reads MemAvailable rather than MemFree', () => {
    // The whole point: MemFree here is 352MB, which would read as a machine
    // about to die, while 8GB is actually reclaimable and available.
    const snapshot = readSystemMemory(() => MEMINFO);

    if (process.platform === 'linux') {
      expect(snapshot.availableMb).toBe(8023);
      expect(snapshot.totalMb).toBe(15941);
    } else {
      // Non-Linux takes the os.freemem() path and ignores the fixture.
      expect(snapshot.totalMb).toBeGreaterThan(0);
    }
  });

  it('falls back to portable numbers when /proc is unreadable', () => {
    const snapshot = readSystemMemory(() => {
      throw new Error('ENOENT');
    });

    expect(snapshot.totalMb).toBeGreaterThan(0);
    expect(snapshot.availableMb).toBeGreaterThanOrEqual(0);
  });

  it('falls back when MemAvailable is missing from an older kernel', () => {
    const snapshot = readSystemMemory(() => 'MemTotal:       16323216 kB\nMemFree: 361284 kB');
    expect(snapshot.totalMb).toBeGreaterThan(0);
  });
});

describe('classifyMemory', () => {
  const at = (availableMb: number): MemorySnapshot => ({ availableMb, totalMb: 16000 });

  it('is ok with headroom', () => {
    expect(classifyMemory(at(8000))).toBe('ok');
  });

  it('warns at the warning threshold and below', () => {
    expect(classifyMemory(at(DEFAULT_THRESHOLDS.warningMb))).toBe('warning');
    expect(classifyMemory(at(1000))).toBe('warning');
  });

  it('is critical at the critical threshold and below', () => {
    expect(classifyMemory(at(DEFAULT_THRESHOLDS.criticalMb))).toBe('critical');
    expect(classifyMemory(at(0))).toBe('critical');
  });

  it('honours custom thresholds', () => {
    expect(classifyMemory(at(900), { warningMb: 2000, criticalMb: 1000 })).toBe('critical');
  });
});

describe('startResourceGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const guard = (
    availability: number[],
    overrides: Partial<Parameters<typeof startResourceGuard>[0]> = {}
  ) => {
    const onCritical = vi.fn();
    const onWarning = vi.fn();
    let index = 0;
    const stop = startResourceGuard({
      isSharing: () => true,
      onCritical,
      onWarning,
      intervalMs: 1000,
      readMemory: () => ({
        availableMb: availability[Math.min(index++, availability.length - 1)],
        totalMb: 16000,
      }),
      ...overrides,
    });
    return { onCritical, onWarning, stop };
  };

  it('stays quiet while there is headroom', () => {
    const { onCritical, onWarning, stop } = guard([8000, 8000, 8000]);
    vi.advanceTimersByTime(3000);
    expect(onCritical).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
    stop();
  });

  it('sheds load once memory is critical', () => {
    const { onCritical, stop } = guard([8000, 300]);
    vi.advanceTimersByTime(2000);
    expect(onCritical).toHaveBeenCalledTimes(1);
    expect(onCritical).toHaveBeenCalledWith({ availableMb: 300, totalMb: 16000 });
    stop();
  });

  it('does not tear the session down again on every poll', () => {
    // The critical handler ends a session; firing it repeatedly would loop.
    const { onCritical, stop } = guard([300, 300, 300, 300]);
    vi.advanceTimersByTime(4000);
    expect(onCritical).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-arms after memory recovers', () => {
    const { onCritical, stop } = guard([300, 8000, 300]);
    vi.advanceTimersByTime(3000);
    expect(onCritical).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not announce a warning while recovering from critical', () => {
    const { onCritical, onWarning, stop } = guard([300, 1000]);
    vi.advanceTimersByTime(2000);
    expect(onCritical).toHaveBeenCalledTimes(1);
    expect(onWarning).not.toHaveBeenCalled();
    stop();
  });

  it('warns before it is too late to act', () => {
    const { onCritical, onWarning, stop } = guard([1000]);
    vi.advanceTimersByTime(1000);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onCritical).not.toHaveBeenCalled();
    stop();
  });

  it('ignores an idle app — other processes are not its business', () => {
    const { onCritical, stop } = guard([100, 100], { isSharing: () => false });
    vi.advanceTimersByTime(2000);
    expect(onCritical).not.toHaveBeenCalled();
    stop();
  });

  it('stops polling once torn down', () => {
    const { onCritical, stop } = guard([8000, 300, 300]);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onCritical).not.toHaveBeenCalled();
  });
});
