/**
 * Session API module.
 *
 * Port of apps/desktop/src/renderer/lib/api.ts sessionApi.
 */
import type { Session, SessionParticipant } from '@pairux/shared-types';
import { apiRequest } from '../api';

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
