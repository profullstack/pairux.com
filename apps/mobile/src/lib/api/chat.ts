/**
 * Chat API module.
 *
 * Port of apps/desktop/src/renderer/lib/api.ts chatApi.
 */
import type { ChatMessage } from '@pairux/shared-types';
import { apiRequest, type ApiResponse } from '../api';

export const CHAT_REQUEST_TIMEOUT_MS = 15_000;

// Bound the entire operation, including auth and body parsing. Some native
// fetch implementations can settle late even after abort, so race explicitly.
async function chatRequest<T>(
  endpoint: string,
  options: RequestInit,
  signal?: AbortSignal
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const interrupted = new Promise<ApiResponse<T>>((resolve) => {
    cancel = () => {
      controller.abort();
      resolve({ error: 'Chat request interrupted', failureKind: 'unknown' });
    };
    timer = setTimeout(cancel, CHAT_REQUEST_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    if (signal?.aborted) {
      cancel();
      return await interrupted;
    }
    return await Promise.race([
      apiRequest<T>(endpoint, { ...options, signal: controller.signal }),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export const chatApi = {
  async send(sessionId: string, content: string, participantId?: string, signal?: AbortSignal) {
    return chatRequest<ChatMessage>(
      '/api/chat/send',
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, content, participantId }),
      },
      signal
    );
  },

  async getHistory(
    sessionId: string,
    options?: { limit?: number; before?: string },
    signal?: AbortSignal
  ) {
    const params = new URLSearchParams({ sessionId });
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.before) params.set('before', options.before);

    return chatRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/api/chat/history?${params.toString()}`,
      {},
      signal
    );
  },
};
