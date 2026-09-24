import { describe, expect, it } from 'vitest';
import { listenForCallback } from './auth.js';

describe('listenForCallback (real loopback socket)', () => {
  it('resolves with the code when the state matches', async () => {
    const loopback = await listenForCallback({ timeoutMs: 5_000 });
    try {
      expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const waiting = loopback.waitForCode('good-state');
      const res = await fetch(`${loopback.redirectUri}?code=abc&state=good-state`);
      expect(res.status).toBe(200);
      await expect(waiting).resolves.toBe('abc');
    } finally {
      loopback.close();
    }
  });

  it('rejects a callback carrying someone else’s state', async () => {
    const loopback = await listenForCallback({ timeoutMs: 5_000 });
    try {
      // Attach the assertion before the callback lands, or the rejection is unhandled.
      const rejected = expect(loopback.waitForCode('mine')).rejects.toThrow(/state did not match/);
      await fetch(`${loopback.redirectUri}?code=abc&state=theirs`);
      await rejected;
    } finally {
      loopback.close();
    }
  });

  it('reports a denial from the consent page', async () => {
    const loopback = await listenForCallback({ timeoutMs: 5_000 });
    try {
      const rejected = expect(loopback.waitForCode('s1')).rejects.toThrow(/denied/);
      await fetch(`${loopback.redirectUri}?error=access_denied&state=s1`);
      await rejected;
    } finally {
      loopback.close();
    }
  });
});
