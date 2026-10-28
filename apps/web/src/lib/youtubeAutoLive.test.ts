import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}));

const mockRefresh = vi.fn();
const mockFind = vi.fn();
const mockTransition = vi.fn();
vi.mock('@/lib/youtube', () => ({
  youtubeOAuthConfigured: () => true,
  refreshAccessToken: (...a: unknown[]) => mockRefresh(...a),
  findTransitionableBroadcasts: (...a: unknown[]) => mockFind(...a),
  transitionToLive: (...a: unknown[]) => mockTransition(...a),
}));

import { autoTransitionYouTube } from './youtubeAutoLive';
import {
  createSeal,
  openPrivateKey,
  sealToPublicKey,
  parseTtl,
  UNLOCK_MAX_TTL_SECONDS,
} from './sealed/crypto';
import { clearAllUnlocks, lockOwner, unlockOwner, privateKeyFor } from './sealed/unlockStore';

let sealedRt = '';
let key: CryptoKey;

describe('autoTransitionYouTube', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clearAllUnlocks();
    if (!sealedRt) {
      const made = await createSeal('correct horse battery', 'user-1');
      key = await openPrivateKey(made.dek, made.seal, 'user-1');
      sealedRt = await sealToPublicKey(
        made.seal.public_key,
        'rt',
        'user-1',
        'youtube_refresh_token'
      );
    }
    unlockOwner('user-1', key, 3600);
  });

  it('transitions the first ready broadcast to live', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: sealedRt } });
    mockRefresh.mockResolvedValue('access-tok');
    mockFind.mockResolvedValue([{ id: 'b1', lifeCycleStatus: 'ready', title: 'X' }]);
    mockTransition.mockResolvedValue(undefined);

    await autoTransitionYouTube('user-1');

    expect(mockRefresh).toHaveBeenCalledWith('rt');
    expect(mockTransition).toHaveBeenCalledWith('access-tok', 'b1');
  });

  it('does nothing when the user has not connected YouTube', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    await autoTransitionYouTube('user-1');

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('never throws when the YouTube API fails', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: sealedRt } });
    mockRefresh.mockRejectedValue(new Error('google down'));

    await expect(autoTransitionYouTube('user-1')).resolves.toBeUndefined();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips (never fails) while the user is locked, and after a restart', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: sealedRt } });
    lockOwner('user-1');
    await expect(autoTransitionYouTube('user-1')).resolves.toBeUndefined();
    unlockOwner('user-1', key, 3600);
    clearAllUnlocks(); // restart
    await autoTransitionYouTube('user-1');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('never uses a plaintext token (no server-side fallback)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: 'plaintext-rt' } });
    await autoTransitionYouTube('user-1');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('unlock TTL is clamped to 7 days and expires', () => {
    const now = 1_000;
    const { expiresAt } = unlockOwner('user-2', key, 30 * 86400, now);
    expect(expiresAt - now).toBe(UNLOCK_MAX_TTL_SECONDS * 1000);
    expect(privateKeyFor('user-2', expiresAt + 1)).toBeNull();
    expect(parseTtl('8h')).toBe(8 * 3600);
  });
});
