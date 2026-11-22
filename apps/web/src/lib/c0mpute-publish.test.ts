import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finishConnect,
  loadToken,
  objectName,
  pkceChallenge,
  safeReturnTo,
  saveToken,
} from './c0mpute-publish';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    location: { origin: 'https://pairux.com' },
  });
});

describe('c0mpute publish helpers', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    // Appendix B of RFC 7636.
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('only returns to same-site paths', () => {
    expect(safeReturnTo('/recordings/x/publish')).toBe('/recordings/x/publish');
    expect(safeReturnTo('//evil.example')).toBe('/recordings');
    expect(safeReturnTo('https://evil.example')).toBe('/recordings');
    expect(safeReturnTo('/\\evil')).toBe('/recordings');
    expect(safeReturnTo(null)).toBe('/recordings');
  });

  it('names objects safely', () => {
    expect(objectName('Weekly demo: v1/2', '2026-11-22T10:00:00Z')).toBe('Weekly demo v1 2.mp4');
    expect(objectName(null, '2026-11-22T10:00:00Z')).toBe('PairUX recording 2026-11-22.mp4');
  });

  it('drops expired tokens', () => {
    saveToken({ accessToken: 'c0k_a', expiresAt: Date.now() + 3_600_000 });
    expect(loadToken()).toBe('c0k_a');
    saveToken({ accessToken: 'c0k_b', expiresAt: Date.now() + 10_000 });
    expect(loadToken()).toBeNull();
  });

  it('refuses a callback whose state does not match, and exchanges a good one', async () => {
    const pending = {
      state: 'S',
      verifier: 'V',
      clientId: 'cid',
      redirectUri: 'https://pairux.com/recordings/c0mpute/callback',
      returnTo: '/recordings/r1/publish',
    };
    const w = window as unknown as { sessionStorage: MemoryStorage };
    w.sessionStorage.setItem('pairux.c0mpute.pending', JSON.stringify(pending));
    await expect(finishConnect(new URLSearchParams('code=c&state=X'))).rejects.toThrow(/state/);

    w.sessionStorage.setItem('pairux.c0mpute.pending', JSON.stringify(pending));
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get('code_verifier')).toBe('V');
      expect(body.get('client_id')).toBe('cid');
      return new Response(JSON.stringify({ access_token: 'c0k_new', scope: 'storage:write' }));
    });
    const next = await finishConnect(
      new URLSearchParams('code=c&state=S'),
      fetchImpl as unknown as typeof fetch
    );
    expect(next).toBe('/recordings/r1/publish');
    expect(loadToken()).toBe('c0k_new');
    // One-shot: a replayed callback fails.
    await expect(finishConnect(new URLSearchParams('code=c&state=S'))).rejects.toThrow();
  });
});
