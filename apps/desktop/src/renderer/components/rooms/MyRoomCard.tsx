import { useEffect, useState } from 'react';
import { Check, Copy, DoorOpen, Loader2 } from 'lucide-react';
import { getElectronAPI } from '@/lib/ipc';
import { API_BASE_URL } from '../../../shared/config';

interface Room {
  id: string;
  slug: string;
  name: string;
  url: string;
  is_default: boolean;
}

async function authed(path: string, init?: RequestInit): Promise<Response | null> {
  const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
  if (!token) return null;
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * The signed-in user's permanent room (pairux.com/m/<slug>): copy the link, or
 * start the room here, which resumes its session (or makes one) and hosts it.
 */
export function MyRoomCard({ onStart }: { onStart: (sessionId: string) => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authed('/api/v1/me/rooms')
      .then((res) => (res?.ok ? (res.json() as Promise<{ data?: { rooms: Room[] } }>) : null))
      .then((body) => {
        if (cancelled) return;
        const rooms = body?.data?.rooms ?? [];
        setRoom(rooms.find((r) => r.is_default) ?? rooms.at(0) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!room) return null;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await authed(`/api/v1/rooms/${encodeURIComponent(room.slug)}/start`, {
        method: 'POST',
      });
      const body = (await res?.json().catch(() => ({}))) as
        { data?: { session: { id: string } }; error?: string } | undefined;
      if (!res?.ok || !body?.data) {
        setError(body?.error ?? 'Could not start your room');
        return;
      }
      onStart(body.data.session.id);
    } catch {
      setError('Could not start your room');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <DoorOpen className="h-4 w-4" /> My room
        </p>
        <button
          type="button"
          onClick={() => {
            void getElectronAPI().invoke('auth:openExternal', `/m/${room.slug}`);
          }}
          className="truncate text-sm text-primary hover:underline"
          title="Your permanent link: people who open it join you while you are in the room"
        >
          {room.url.replace(/^https?:\/\//, '')}
        </button>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(room.url).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
          className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-muted/80"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {starting && <Loader2 className="h-4 w-4 animate-spin" />}
          Start my room
        </button>
      </div>
    </div>
  );
}
