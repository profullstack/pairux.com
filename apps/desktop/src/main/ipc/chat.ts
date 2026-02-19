import { ipcMain } from 'electron';
import { getStoredAuth, isAuthExpired } from '../auth/secure-storage';
import type { ChatMessage } from '@pairux/shared-types';
import { API_BASE_URL } from '../../shared/config';
import { formatNetworkError } from './network-error';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

function getAuthHeaders(): Record<string, string> | null {
  const stored = getStoredAuth();
  if (!stored || isAuthExpired(stored)) {
    return null;
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${stored.accessToken}`,
  };
}

export function registerChatHandlers(): void {
  console.log('[Chat] Registering chat IPC handlers');

  // Send chat message
  ipcMain.handle(
    'chat:send',
    async (
      _event,
      args: { sessionId: string; content: string }
    ): Promise<{ success: true; message: ChatMessage } | { success: false; error: string }> => {
      try {
        const headers = getAuthHeaders();
        if (!headers) {
          return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${API_BASE_URL}/api/chat/send`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId: args.sessionId,
            content: args.content,
          }),
        });

        const data = (await response.json()) as ApiResponse<ChatMessage>;

        if (!response.ok) {
          console.error('[Chat] Send message error:', data);
          return { success: false, error: data.error ?? 'Failed to send message' };
        }

        if (!data.data) {
          return { success: false, error: 'Invalid response from server' };
        }

        return { success: true, message: data.data };
      } catch (err) {
        console.error('[Chat] Send message error:', err);
        return { success: false, error: formatNetworkError(err) };
      }
    }
  );

  // Get chat history
  ipcMain.handle(
    'chat:getHistory',
    async (
      _event,
      args: { sessionId: string; limit?: number; before?: string }
    ): Promise<
      | { success: true; messages: ChatMessage[]; hasMore: boolean }
      | { success: false; error: string }
    > => {
      try {
        const headers = getAuthHeaders();
        if (!headers) {
          return { success: false, error: 'Not authenticated' };
        }

        const params = new URLSearchParams({
          sessionId: args.sessionId,
        });

        if (args.limit) {
          params.set('limit', args.limit.toString());
        }
        if (args.before) {
          params.set('before', args.before);
        }

        const response = await fetch(`${API_BASE_URL}/api/chat/history?${params.toString()}`, {
          method: 'GET',
          headers,
        });

        const data = (await response.json()) as ApiResponse<ChatHistoryResponse>;

        if (!response.ok) {
          console.error('[Chat] Get history error:', data);
          return { success: false, error: data.error ?? 'Failed to get chat history' };
        }

        if (!data.data) {
          return { success: false, error: 'Invalid response from server' };
        }

        return {
          success: true,
          messages: data.data.messages,
          hasMore: data.data.hasMore,
        };
      } catch (err) {
        console.error('[Chat] Get history error:', err);
        return { success: false, error: formatNetworkError(err) };
      }
    }
  );

  console.log('[Chat] Chat IPC handlers registered');
}
