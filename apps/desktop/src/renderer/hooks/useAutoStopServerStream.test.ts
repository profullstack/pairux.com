import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoStopServerStream } from './useAutoStopServerStream';

describe('useAutoStopServerStream', () => {
  let stop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stop = vi.fn();
  });

  it('stops the egress when hosting ends while a server stream is running', () => {
    const { rerender } = renderHook(
      ({ hosting, streaming }) => useAutoStopServerStream(hosting, streaming, stop),
      { initialProps: { hosting: true, streaming: true } }
    );
    expect(stop).not.toHaveBeenCalled();

    // Host publish drops (e.g. dead NIC) — egress is still tracked.
    rerender({ hosting: false, streaming: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not stop when hosting ends but no server stream is running', () => {
    const { rerender } = renderHook(
      ({ hosting, streaming }) => useAutoStopServerStream(hosting, streaming, stop),
      { initialProps: { hosting: true, streaming: false } }
    );
    rerender({ hosting: false, streaming: false });
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not fire on mount (no host->not-host transition yet)', () => {
    renderHook(() => useAutoStopServerStream(false, true, stop));
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not fire while hosting stays active as the server stream toggles', () => {
    const { rerender } = renderHook(
      ({ hosting, streaming }) => useAutoStopServerStream(hosting, streaming, stop),
      { initialProps: { hosting: true, streaming: false } }
    );
    rerender({ hosting: true, streaming: true });
    rerender({ hosting: true, streaming: false });
    expect(stop).not.toHaveBeenCalled();
  });
});
