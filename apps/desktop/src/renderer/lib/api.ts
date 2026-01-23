import type { ChatMessage, Session, SessionParticipant } from '@pairux/shared-types';

// API base URL - use localhost for development, production URL for prod
const meta = import.meta as unknown as { env?: { DEV?: boolean; VITE_API_URL?: string } };
const isDev = meta.env?.DEV === true;
const envApiUrl = meta.env?.VITE_API_URL;
const API_BASE_URL = isDev ? 'http://localhost:3000' : (envApiUrl ?? 'https://pairux.com');

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
      credentials: 'include', // Include cookies for auth
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      return { error: data.error ?? `Request failed with status ${String(response.status)}` };
    }

    return data;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Network error' };
  }
}

// Session API
export const sessionApi = {
  async create(settings?: { allowGuestControl?: boolean; maxParticipants?: number }) {
    return apiRequest<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(settings ?? {}),
    });
  },

  async get(sessionId: string) {
    return apiRequest<Session & { session_participants: SessionParticipant[] }>(
      `/api/sessions/${sessionId}`
    );
  },

  async list() {
    return apiRequest<Session[]>('/api/sessions');
  },

  async end(sessionId: string) {
    return apiRequest<Session>(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  },

  async join(joinCode: string, displayName: string) {
    return apiRequest<SessionParticipant>(`/api/sessions/join/${joinCode}`, {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });
  },

  async lookup(joinCode: string) {
    return apiRequest<{ session: Session }>(`/api/sessions/join/${joinCode}`);
  },
};

// Chat API
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

  createStream(sessionId: string): EventSource {
    return new EventSource(`${API_BASE_URL}/api/chat/stream?sessionId=${sessionId}`);
  },
};
