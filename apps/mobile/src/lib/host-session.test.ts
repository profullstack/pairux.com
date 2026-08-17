import { describe, expect, it, vi } from 'vitest';
import { endHostSession } from './host-session';

describe('endHostSession', () => {
  it('keeps the local host active when the server cannot end the session', async () => {
    const stopScreenShare = vi.fn().mockResolvedValue(undefined);
    const endSession = vi.fn().mockResolvedValue({ error: 'Network error' });
    const stopHosting = vi.fn();
    const goBack = vi.fn();

    await expect(
      endHostSession({ stopScreenShare, endSession, stopHosting, goBack })
    ).rejects.toThrow('Network error');

    expect(stopScreenShare).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(stopHosting).not.toHaveBeenCalled();
    expect(goBack).not.toHaveBeenCalled();
  });

  it('tears down and leaves only after the server ends the session', async () => {
    const calls: string[] = [];
    const stopScreenShare = vi.fn(async () => {
      calls.push('screen');
    });
    const endSession = vi.fn(async () => {
      calls.push('server');
      return { data: { id: 'session-1' } };
    });
    const stopHosting = vi.fn(() => {
      calls.push('host');
    });
    const goBack = vi.fn(() => {
      calls.push('back');
    });

    await endHostSession({ stopScreenShare, endSession, stopHosting, goBack });

    expect(calls).toEqual(['screen', 'server', 'host', 'back']);
  });
});
