/**
 * Chat API module.
 *
 * Port of apps/desktop/src/renderer/lib/api.ts chatApi.
 */
import type { ChatMessage } from '@pairux/shared-types';
import { apiRequest } from '../api';

export const chatApi = {
  async send(sessionId: string, content: string, participantId?: string) {
    return apiRequest<ChatMessage>('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({ sessionId, content, participantId }),
    });
  },

  async getHistory(sessionId: string, options?: { limit?: number; before?: string }) {
    const params = new URLSearchParams({ sessionId });
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.before) params.set('before', options.before);

    return apiRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/api/chat/history?${params.toString()}`
    );
  },
};
