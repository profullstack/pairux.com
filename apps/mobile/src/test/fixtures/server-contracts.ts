/**
 * Server-shaped response fixtures for mobile contract tests.
 *
 * Every shape here mirrors an actual route handler in apps/web/src/app/api:
 *  - auth login/signup/refresh wrap payloads as `{ data: ... }`
 *    (apps/web/src/lib/api.ts successResponse) and return Supabase's
 *    `expires_at` in SECONDS since epoch;
 *  - GET /api/sessions/join/[joinCode] returns the session payload directly
 *    (or a scheduled-meeting payload flagged `scheduled: true`);
 *  - POST /api/sessions/join/[joinCode] returns the session_participants row
 *    from the join_session RPC;
 *  - the signaling SSE `connected` event carries the server-assigned
 *    subscriberId (the auth user id for authenticated clients).
 *
 * The IDs are deliberately distinct so tests fail whenever code confuses the
 * authenticated user id, the participant row id, and the SSE subscriber id.
 */

export const AUTH_USER_ID = 'auth-user-1111';
export const PARTICIPANT_ROW_ID = 'participant-row-2222';
export const HOST_USER_ID = 'host-user-3333';
export const OTHER_VIEWER_ID = 'other-viewer-4444';
export const SESSION_ID = 'session-5555';

// Supabase expiry: seconds since epoch. Clients must store milliseconds.
export const SUPABASE_EXPIRES_AT_SECONDS = 1_795_000_000;

export const authUser = { id: AUTH_USER_ID, email: 'user@example.com' };

export const loginSuccessEnvelope = {
  data: {
    user: authUser,
    session: {
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiresAt: SUPABASE_EXPIRES_AT_SECONDS,
    },
  },
};

export const signupNeedsConfirmationEnvelope = {
  data: {
    user: authUser,
    message: 'Check your email to confirm your account',
    needsConfirmation: true,
  },
};

export const signupConfirmedEnvelope = {
  data: {
    user: authUser,
    message: 'Account created successfully',
    needsConfirmation: false,
  },
};

export const refreshSuccessEnvelope = {
  data: {
    session: {
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresAt: SUPABASE_EXPIRES_AT_SECONDS,
    },
  },
};

export const joinLookupLiveEnvelope = {
  data: {
    id: SESSION_ID,
    join_code: 'ABC123',
    status: 'active',
    settings: { allowGuestControl: false, maxParticipants: 20 },
    created_at: '2026-09-01T00:00:00.000Z',
    participant_count: 2,
  },
};

export const joinLookupScheduledEnvelope = {
  data: {
    scheduled: true as const,
    id: 'sched-6666',
    join_code: 'ABC123',
    title: 'Team Standup',
    description: null,
    scheduled_at: '2026-09-08T10:00:00.000Z',
    duration_minutes: 30,
    invitees: [{ name: 'Alice', rsvp_status: 'accepted' }],
  },
};

export const joinParticipantEnvelope = {
  data: {
    id: PARTICIPANT_ROW_ID,
    session_id: SESSION_ID,
    user_id: AUTH_USER_ID,
    display_name: 'Phone Viewer',
    role: 'viewer',
    control_state: 'view-only',
    joined_at: '2026-09-07T00:00:00.000Z',
    left_at: null,
  },
};

export const sseIceServers = [
  { urls: 'turn:turn.pairux.com:3478', username: 'turn-user', credential: 'turn-pass' },
];

/** SSE `connected` event payload for an authenticated viewer. */
export function viewerConnectedEventData(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: SESSION_ID,
    subscriberId: AUTH_USER_ID,
    isHost: false,
    iceServers: sseIceServers,
    ...overrides,
  });
}

/** SSE `connected` event payload for the authenticated host. */
export function hostConnectedEventData(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: SESSION_ID,
    subscriberId: HOST_USER_ID,
    isHost: true,
    iceServers: sseIceServers,
    ...overrides,
  });
}
