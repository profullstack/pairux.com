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

describe('autoTransitionYouTube', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions the first ready broadcast to live', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: 'rt' } });
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
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: 'rt' } });
    mockRefresh.mockRejectedValue(new Error('google down'));

    await expect(autoTransitionYouTube('user-1')).resolves.toBeUndefined();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
