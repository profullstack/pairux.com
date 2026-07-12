import { useEffect, useRef, useState } from 'react';
import { Radio, ExternalLink, Loader2, X, ImagePlus, AtSign } from 'lucide-react';
import type { Session } from '@pairux/shared-types';
import { API_BASE_URL } from '../../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PublishToLiveProps {
  session: Pick<Session, 'id' | 'is_public' | 'subject' | 'description' | 'banner_url'>;
}

// Locally-cached "last used" live settings, so a host doesn't re-enter their
// title/description/cover every time they publish a new room. Persisted in the
// renderer's localStorage (survives app restarts).
const CACHE_KEY = 'pairux.live.settings';
interface LiveSettingsCache {
  subject: string;
  description: string;
  banner: string | null; // data URL of the last cover (already 16:9-cropped)
}
function loadLiveCache(): LiveSettingsCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw) as LiveSettingsCache;
  } catch {
    /* ignore */
  }
  return { subject: '', description: '', banner: null };
}
function saveLiveCache(cache: LiveSettingsCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore (e.g. quota) — caching is a convenience */
  }
}
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

// Cover-crop the chosen image to a 16:9 frame (center) and re-encode as JPEG, so
// the stored banner is a small, consistent 1280x720 — matching how it's shown on
// /live (a 16:9 object-cover box). Returns both a Blob (to upload) and a data URL
// (to preview + cache).
function cropTo16x9(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const TW = 1280;
      const TH = 720;
      const canvas = document.createElement('canvas');
      canvas.width = TW;
      canvas.height = TH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      const scale = Math.max(TW / img.width, TH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (TW - w) / 2, (TH - h) / 2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, dataUrl });
          else reject(new Error('Could not encode image'));
        },
        'image/jpeg',
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

/**
 * Host control to publish the current room to the public pairux.com/live
 * directory. Sets visibility (set_room_visibility RPC) and optionally uploads a
 * 16:9 banner image. A title (subject) is required to go live.
 */
export function PublishToLive({ session }: PublishToLiveProps) {
  // For a brand-new (never-published) room, pre-fill from the last-used settings
  // so the host doesn't retype the title/description/cover. An already-published
  // room shows its own saved values.
  const cache = loadLiveCache();
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(session.is_public);
  const [subject, setSubject] = useState(session.subject ?? cache.subject);
  const [description, setDescription] = useState(session.description ?? cache.description);
  const [bannerPreview, setBannerPreview] = useState<string | null>(
    session.banner_url ?? cache.banner
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerBlobRef = useRef<Blob | null>(null);
  // Data URL of the current cover (freshly picked or restored from cache), used
  // to re-upload a cached cover for a new room and to persist the cache.
  const bannerDataUrlRef = useRef<string | null>(
    session.banner_url ? null : (cache.banner ?? null)
  );

  // The host's channels — a public live must go out on one of them. undefined
  // while loading.
  interface Chan {
    id: string;
    handle: string;
    name: string;
  }
  const [channels, setChannels] = useState<Chan[] | undefined>(undefined);
  const [channelId, setChannelId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
        if (!token || controller.signal.aborted) return;
        const res = await fetch(`${API_BASE_URL}/api/channels`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as { data?: { channels?: Chan[] } };
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- signal is aborted async in cleanup
        if (!controller.signal.aborted) {
          const list = res.ok ? (body.data?.channels ?? []) : [];
          setChannels(list);
          setChannelId((prev) => prev || list[0]?.id || '');
        }
      } catch {
        if (!controller.signal.aborted) setChannels([]);
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [open]);

  const openLiveDirectory = () => {
    void getElectronAPI().invoke('auth:openExternal', '/live');
  };

  const onPickBanner = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setError(null);
    try {
      const cropped = await cropTo16x9(file);
      bannerBlobRef.current = cropped.blob;
      bannerDataUrlRef.current = cropped.dataUrl;
      setBannerPreview(cropped.dataUrl);
    } catch {
      setError("Couldn't read that image. Try a different file.");
    }
  };

  const submit = async (nextPublic: boolean) => {
    setError(null);
    if (nextPublic && subject.trim().length < 3) {
      setError('Add a title of at least 3 characters to go live.');
      return;
    }
    if (nextPublic && !channelId) {
      setError('Pick a channel to go live on (create one in your dashboard).');
      return;
    }
    setBusy(true);
    try {
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      if (!token) {
        setError('Sign in on this device to publish your room.');
        return;
      }

      // Assign this live to the chosen channel before publishing.
      if (nextPublic && channelId) {
        const chRes = await fetch(`${API_BASE_URL}/api/sessions/${session.id}/channel`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ channelId }),
        });
        if (!chRes.ok) {
          const c = (await chRes.json().catch(() => ({}))) as { error?: string };
          setError(c.error ?? 'Could not set the channel.');
          return;
        }
      }

      // Upload the cover (only when staying/going public). Use a freshly-picked
      // one, or re-upload the cached cover for a room that doesn't have one yet.
      let bannerToUpload = bannerBlobRef.current;
      if (
        nextPublic &&
        !bannerToUpload &&
        !session.banner_url &&
        bannerDataUrlRef.current?.startsWith('data:')
      ) {
        bannerToUpload = await dataUrlToBlob(bannerDataUrlRef.current);
      }
      if (nextPublic && bannerToUpload) {
        const fd = new FormData();
        fd.append('banner', bannerToUpload, 'banner.jpg');
        const bannerRes = await fetch(`${API_BASE_URL}/api/sessions/${session.id}/banner`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!bannerRes.ok) {
          const b = (await bannerRes.json().catch(() => ({}))) as { error?: string };
          setError(b.error ?? 'Could not upload the banner.');
          return;
        }
        bannerBlobRef.current = null;
      }

      const res = await fetch(`${API_BASE_URL}/api/sessions/${session.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          nextPublic
            ? {
                isPublic: true,
                subject: subject.trim(),
                description: description.trim() || undefined,
              }
            : { isPublic: false }
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not update visibility. Please try again.');
        return;
      }
      setIsPublic(nextPublic);
      if (nextPublic) {
        // Remember these settings for the next room the host publishes.
        saveLiveCache({
          subject: subject.trim(),
          description: description.trim(),
          banner: bannerDataUrlRef.current,
        });
      } else {
        setOpen(false);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant={isPublic ? 'default' : 'secondary'}
        size="sm"
        onClick={() => {
          setOpen((v) => !v);
        }}
        title={isPublic ? 'Live on pairux.com/live' : 'Publish this room to pairux.com/live'}
      >
        <Radio className={`h-4 w-4 ${isPublic ? 'text-red-400' : ''}`} />
        {isPublic ? 'Live on /live' : 'Go Live'}
      </Button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-input bg-background p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Publish to the live directory</h4>
            <button
              onClick={() => {
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Lists your room publicly on pairux.com/live so anyone can discover and join it.
          </p>

          {/* Which channel this public live goes out on */}
          <label className="mb-1 block text-xs font-medium">Channel</label>
          {channels === undefined ? (
            <span className="text-xs text-muted-foreground">Loading your channels…</span>
          ) : channels.length === 0 ? (
            <button
              type="button"
              onClick={() => void getElectronAPI().invoke('auth:openExternal', '/dashboard')}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <AtSign className="h-3 w-3" />
              Create a channel in your dashboard first <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <select
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
              }}
              disabled={busy}
              className="mb-3 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (@{c.handle})
                </option>
              ))}
            </select>
          )}

          <label className="mb-1 block text-xs font-medium">Title (required)</label>
          <Input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
            }}
            maxLength={120}
            placeholder="e.g. Live pair-programming: Rust CLI"
            disabled={busy}
          />
          <label className="mb-1 mt-3 block text-xs font-medium">
            Description (optional, markdown)
          </label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            maxLength={500}
            rows={3}
            placeholder="Links, **bold**, and line breaks welcome…"
            disabled={busy}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <label className="mb-1 mt-3 block text-xs font-medium">Banner (optional, 16:9)</label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-input bg-muted disabled:opacity-60"
            title="Choose a banner image"
          >
            {bannerPreview ? (
              <img
                src={bannerPreview}
                alt="Banner preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <ImagePlus className="h-5 w-5" />
                Choose image
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickBanner(e)}
          />

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            {isPublic ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void submit(false)}
                >
                  Unpublish
                </Button>
              </>
            ) : (
              <Button variant="default" size="sm" disabled={busy} onClick={() => void submit(true)}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Radio className="h-4 w-4" />
                )}
                Go Live
              </Button>
            )}
          </div>

          <button
            onClick={openLiveDirectory}
            className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View pairux.com/live <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
