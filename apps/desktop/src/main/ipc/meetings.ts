import { ipcMain } from 'electron';
import { apiFetch } from '../lib/apiFetch';
import { getValidAuth } from '../auth/secure-storage';
import type { Session } from '@pairux/shared-types';
import type { ScheduledMeeting, StartMeetingResult } from '../../preload/api';
import { API_BASE_URL } from '../../shared/config';
import { formatNetworkError } from './network-error';

/**
 * The host's scheduled meetings, in the app that can actually run one.
 *
 * A calendar invite carries one meeting's join code, so a host who has three
 * meetings booked has three different links and no list — the invite is the
 * only place the identity of a meeting is written down. These two calls are
 * what let the desktop app ask "what am I supposed to be running?" instead.
 */

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const stored = await getValidAuth(API_BASE_URL);
  if (!stored) return null;

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${stored.accessToken}`,
  };
}

export function registerMeetingHandlers(): void {
  console.log('[Meetings] Registering meeting IPC handlers');

  // The host's upcoming meetings, including any already running. The web
  // endpoint rolls recurring series forward and applies the "still within its
  // duration" window, so the app renders what it is given rather than
  // re-deriving either rule.
  ipcMain.handle(
    'meetings:list',
    async (): Promise<
      { success: true; meetings: ScheduledMeeting[] } | { success: false; error: string }
    > => {
      try {
        const headers = await getAuthHeaders();
        if (!headers) return { success: false, error: 'Not authenticated' };

        const response = await apiFetch(`${API_BASE_URL}/api/scheduled-sessions?filter=upcoming`, {
          method: 'GET',
          headers,
        });

        const data = (await response.json()) as ApiResponse<ScheduledMeeting[]>;

        if (!response.ok) {
          console.error('[Meetings] List error:', data);
          return { success: false, error: data.error ?? 'Failed to load meetings' };
        }

        return { success: true, meetings: data.data ?? [] };
      } catch (err) {
        console.error('[Meetings] List error:', err);
        return { success: false, error: formatNetworkError(err) };
      }
    }
  );

  // Opening the room. The server creates or adopts the session, ties it to the
  // meeting and mails the guest list; all of that is deliberately one request,
  // so the app cannot half-start a meeting by dying between the steps.
  ipcMain.handle(
    'meetings:start',
    async (
      _event,
      args: { scheduledSessionId: string }
    ): Promise<StartMeetingResult | { success: false; error: string }> => {
      try {
        const headers = await getAuthHeaders();
        if (!headers) return { success: false, error: 'Not authenticated' };

        const response = await apiFetch(
          `${API_BASE_URL}/api/scheduled-sessions/${args.scheduledSessionId}/start`,
          { method: 'POST', headers }
        );

        const data = (await response.json()) as ApiResponse<{
          session: Session;
          joinCode: string;
          resumed: boolean;
          notified: number;
        }>;

        if (!response.ok || !data.data) {
          console.error('[Meetings] Start error:', data);
          return { success: false, error: data.error ?? 'Failed to start the meeting' };
        }

        console.log('[Meetings] Started meeting:', args.scheduledSessionId, data.data.session.id);
        return {
          success: true,
          session: data.data.session,
          joinCode: data.data.joinCode,
          resumed: data.data.resumed,
          notified: data.data.notified,
        };
      } catch (err) {
        console.error('[Meetings] Start error:', err);
        return { success: false, error: formatNetworkError(err) };
      }
    }
  );
}
