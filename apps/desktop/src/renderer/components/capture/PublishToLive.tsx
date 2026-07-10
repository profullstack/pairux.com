import { useRef, useState } from 'react';
import { Radio, ExternalLink, Loader2, X, ImagePlus } from 'lucide-react';
import type { Session } from '@pairux/shared-types';
import { API_BASE_URL } from '../../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PublishToLiveProps {
  session: Pick<Session, 'id' | 'is_public' | 'subject' | 'description' | 'banner_url'>;
}

// Cover-crop the chosen image to a 16:9 frame (center) and re-encode as JPEG, so
// the stored banner is a small, consistent 1280x720 — matching how it's shown on
// /live (a 16:9 object-cover box).
function cropTo16x9(file: File): Promise<Blob> {
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
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
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
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(session.is_public);
  const [subject, setSubject] = useState(session.subject ?? '');
  const [description, setDescription] = useState(session.description ?? '');
  const [bannerPreview, setBannerPreview] = useState<string | null>(session.banner_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerBlobRef = useRef<Blob | null>(null);

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
      bannerBlobRef.current = cropped;
      setBannerPreview((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return URL.createObjectURL(cropped);
      });
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
    setBusy(true);
    try {
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      if (!token) {
        setError('Sign in on this device to publish your room.');
        return;
      }

      // Upload a freshly-picked banner first (only when staying/going public).
      if (nextPublic && bannerBlobRef.current) {
        const fd = new FormData();
        fd.append('banner', bannerBlobRef.current, 'banner.jpg');
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
      if (!nextPublic) setOpen(false);
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
          <label className="mb-1 mt-3 block text-xs font-medium">Description (optional)</label>
          <Input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            maxLength={500}
            placeholder="What's happening in this room?"
            disabled={busy}
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
