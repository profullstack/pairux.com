import { describe, it, expect, vi, beforeEach } from 'vitest';
import { announceTailnet, buildTailnetHello } from './tailnetHello';
import { mockElectronAPI } from '../../test/setup';

describe('buildTailnetHello', () => {
  it('carries the addresses and the reply flag', () => {
    const message = buildTailnetHello('viewer-1', ['100.64.0.5'], true);
    expect(message).toMatchObject({
      type: 'tailnet-hello',
      participantId: 'viewer-1',
      ips: ['100.64.0.5'],
      reply: true,
    });
    expect(typeof message.timestamp).toBe('number');
  });
});

describe('announceTailnet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the handshake with reply=false, so the host knows to answer', async () => {
    mockElectronAPI.invoke.mockResolvedValue({ ips: ['100.64.0.5', '100.64.0.6'] });
    const send = vi.fn();

    await announceTailnet('viewer-1', send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      participantId: 'viewer-1',
      ips: ['100.64.0.5', '100.64.0.6'],
      reply: false,
    });
  });

  // A peer with no tailnet address has nothing to offer, and an empty greeting
  // would only make the host log a verdict it cannot reach.
  it('stays quiet when this machine has no tailnet address', async () => {
    mockElectronAPI.invoke.mockResolvedValue({ ips: [] });
    const send = vi.fn();

    await announceTailnet('viewer-1', send);

    expect(send).not.toHaveBeenCalled();
  });

  it('stays quiet, and does not throw, when Tailscale cannot be queried', async () => {
    mockElectronAPI.invoke.mockRejectedValue(new Error('ENOENT'));
    const send = vi.fn();

    await expect(announceTailnet('viewer-1', send)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
