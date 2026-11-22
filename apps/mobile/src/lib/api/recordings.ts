/**
 * Recordings + cloud edits API (standard `{ data }` / `{ error }` envelope,
 * unwrapped by apiRequest).
 *
 * GET    /api/v1/recordings              → { data: { recordings } }
 * GET    /api/v1/recordings/:id          → { data: { recording } }
 * POST   /api/v1/recordings/:id/edits    → 202 { data: { recording } }  (body { plan, subject? })
 * DELETE /api/v1/recordings/:id          (edited recordings only)
 */
import type { EditPlan } from '@pairux/video-edit';
import { apiRequest } from '../api';

export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed';

export interface Recording {
  id: string;
  subject: string | null;
  status: RecordingStatus;
  duration_seconds: number | null;
  size_bytes: number | null;
  playback_url: string | null;
  created_at: string;
  parent_recording_id: string | null;
  edit_progress: number | null;
  edit_error: string | null;
}

export const recordingsApi = {
  list() {
    return apiRequest<{ recordings: Recording[] }>('/api/v1/recordings');
  },
  get(id: string) {
    return apiRequest<{ recording: Recording }>(`/api/v1/recordings/${encodeURIComponent(id)}`);
  },
  edit(id: string, plan: EditPlan, subject?: string) {
    return apiRequest<{ recording: Recording }>(
      `/api/v1/recordings/${encodeURIComponent(id)}/edits`,
      { method: 'POST', body: JSON.stringify(subject ? { plan, subject } : { plan }) }
    );
  },
  remove(id: string) {
    return apiRequest<{ ok?: boolean }>(`/api/v1/recordings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
