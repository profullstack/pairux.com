/** A recording as /api/v1/recordings returns it. */
export interface RecordingItem {
  id: string;
  subject: string | null;
  status: 'recording' | 'processing' | 'ready' | 'failed';
  duration_seconds: number | null;
  size_bytes: number | null;
  playback_url: string | null;
  created_at: string;
  parent_recording_id: string | null;
  edit_progress: number | null;
  edit_error: string | null;
}

/** Unwrap the app's { data } / { error } envelope. */
export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Unauthorized');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok || body.data === undefined)
    throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  return body.data;
}

export function formatBytes(n: number | null): string {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? 'B'}`;
}

/** The desktop app's deep link for editing a file locally (and publishing to c0mpute). */
export function desktopEditLink(url: string, title: string | null): string {
  const q = new URLSearchParams({ url });
  if (title) q.set('title', title);
  return `pairux://edit?${q.toString()}`;
}
