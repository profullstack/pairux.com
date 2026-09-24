/**
 * Session API module.
 *
 * Port of apps/desktop/src/renderer/lib/api.ts sessionApi.
 *
 * GET /api/sessions/join/[joinCode] returns the session payload directly
 * (or a scheduled-meeting payload discriminated by `scheduled: true`),
 * matching the desktop session:lookup handler in
 * apps/desktop/src/main/ipc/session.ts — there is no `{ session }` wrapper.
 */
import type { CallAnalysisSettings, Session, SessionParticipant } from '@pairux/shared-types';
import { apiRequest } from '../api';

export interface JoinLookupSession {
  id: string;
  join_code: string;
  status: string;
  settings: { quality?: string; allowControl?: boolean; maxParticipants?: number };
  created_at: string;
  participant_count: number;
}

export interface JoinLookupScheduled {
  scheduled: true;
  id: string;
  join_code: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  invitees: { name: string | null; rsvp_status: string }[];
}

export type JoinLookupResult = JoinLookupSession | JoinLookupScheduled;

export function isScheduledLookup(result: JoinLookupResult): result is JoinLookupScheduled {
  return 'scheduled' in result && result.scheduled;
}

export const sessionApi = {
  async create(settings?: {
    allowGuestControl?: boolean;
    maxParticipants?: number;
    /** AI call analysis, chosen before the call starts. */
    analysis?: CallAnalysisSettings;
  }) {
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

  /** Host removes a participant (used for agents, which have no WebRTC link to kick). */
  async removeParticipant(sessionId: string, participantId: string) {
    return apiRequest<{ success: boolean; participantId: string }>(
      `/api/sessions/${sessionId}/participants/${participantId}`,
      { method: 'DELETE' }
    );
  },

  async lookup(joinCode: string) {
    return apiRequest<JoinLookupResult>(`/api/sessions/join/${joinCode}`);
  },
};
