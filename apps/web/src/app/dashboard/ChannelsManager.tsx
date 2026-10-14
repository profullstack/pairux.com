'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Plus,
  Copy,
  Check,
  KeyRound,
  ExternalLink,
  ImagePlus,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MyChannel } from '@pairux/shared-types';
import { WorkspacePicker, useMyOrgs, type Workspace } from '@/components/orgs/WorkspacePicker';
import { RestreamManager } from './RestreamManager';
import { ChannelWebsiteEditor } from './ChannelWebsiteEditor';

// Where OBS / any RTMP client points. The stream key selects the channel.
const RTMP_INGEST_URL = 'rtmp://rtmp.pairux.com/live';

// Decode a data: URL to a Blob without fetch() (renderer CSP may block data:).
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mime = /:(.*?)[;,]/.exec(header)?.[1] ?? 'application/octet-stream';
  if (header.includes(';base64')) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

// Cover-crop an image to WxH (center) and return a JPEG blob.
function cropImage(file: Blob, tw: number, th: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no canvas'));
        return;
      }
      const scale = Math.max(tw / img.width, th / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (tw - w) / 2, (th - h) / 2, w, h);
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('encode failed'));
        },
        'image/jpeg',
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

export function ChannelsManager() {
  const t = useTranslations('dashboard.channels');
  const [channels, setChannels] = useState<MyChannel[] | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [creating, setCreating] = useState(false);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const orgs = useMyOrgs();
  const [owner, setOwner] = useState<Workspace>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<{ id: string; kind: 'banner' | 'avatar' } | null>(null);
  const [bannerPrompt, setBannerPrompt] = useState<Record<string, string>>({});
  const [genBanner, setGenBanner] = useState<string | null>(null);

  const pickImage = (id: string, kind: 'banner' | 'avatar') => {
    pendingRef.current = { id, kind };
    fileRef.current?.click();
  };

  // Generate a properly-sized 6:1 channel banner with AI from the channel's
  // current banner (design input) + an optional prompt.
  const onGenerateBanner = async (ch: MyChannel) => {
    setGenBanner(ch.id);
    setError(null);
    try {
      const res = await fetch('/api/live/generate-banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'channel',
          imageDataUrl: ch.banner_url ?? undefined,
          subject: ch.name,
          description: ch.description ?? undefined,
          prompt: (bannerPrompt[ch.id] ?? '').trim() || undefined,
        }),
      });
      const b = (await res.json()) as { data?: { image?: string }; error?: string };
      const image = b.data?.image;
      if (!res.ok || !image) {
        setError(b.error ?? t('bannerGenerateFailed'));
        return;
      }
      // Decode → normalize to exactly 1500x250 → upload as the channel banner.
      const cropped = await cropImage(dataUrlToBlob(image), 1500, 250);
      const fd = new FormData();
      fd.append('image', cropped, 'banner.jpg');
      const up = await fetch(`/api/channels/${ch.id}/image?kind=banner`, {
        method: 'POST',
        body: fd,
      });
      if (!up.ok) {
        const u = (await up.json()) as { error?: string };
        setError(u.error ?? t('bannerSaveFailed'));
        return;
      }
      await load();
    } catch {
      setError(t('bannerFailed'));
    } finally {
      setGenBanner(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = pendingRef.current;
    pendingRef.current = null;
    if (!file || !target) return;
    setUploading(`${target.id}-${target.kind}`);
    setError(null);
    try {
      const blob =
        target.kind === 'avatar'
          ? await cropImage(file, 400, 400)
          : await cropImage(file, 1500, 250);
      const fd = new FormData();
      fd.append('image', blob, `${target.kind}.jpg`);
      const res = await fetch(`/api/channels/${target.id}/image?kind=${target.kind}`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        setError(b.error ?? t('uploadFailed'));
        return;
      }
      await load();
    } catch {
      setError(t('processFailed'));
    } finally {
      setUploading(null);
    }
  };

  const load = async () => {
    try {
      const res = await fetch('/api/channels');
      if (res.status === 401) {
        setNeedsAuth(true);
        setChannels([]);
        return;
      }
      const body = (await res.json()) as { data?: { channels: MyChannel[] } };
      setChannels(body.data?.channels ?? []);
    } catch {
      setChannels([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setError(null);
    if (!/^[A-Za-z0-9_]{3,30}$/.test(handle.trim())) {
      setError(t('handleInvalid'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          ...(owner.orgId ? { orgId: owner.orgId } : {}),
          ...(owner.teamId ? { teamId: owner.teamId } : {}),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t('createFailed'));
        return;
      }
      setHandle('');
      setName('');
      setDescription('');
      await load();
    } catch {
      setError(t('networkError'));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => {
        setCopied((c) => (c === id ? null : c));
      }, 1800);
    } catch {
      // ignore
    }
  };

  if (channels === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
        <p className="text-gray-600">{t('signInPrompt')}</p>
        <Link
          href="/login?next=/dashboard"
          className="bg-primary-600 hover:bg-primary-700 mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
        >
          {t('signIn')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFile(e)}
      />
      <div className="space-y-4">
        {channels.length === 0 && <p className="text-sm text-gray-500">{t('empty')}</p>}
        {channels.map((ch) => {
          const show = revealed.has(ch.id);
          return (
            <div
              key={ch.id}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
            >
              {/* Banner */}
              <button
                type="button"
                onClick={() => {
                  pickImage(ch.id, 'banner');
                }}
                disabled={uploading === `${ch.id}-banner`}
                className="group relative block aspect-[6/1] w-full overflow-hidden bg-gray-100"
                title={t('uploadBanner')}
              >
                {ch.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ch.banner_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="gradient-bg h-full w-full" />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                  {uploading === `${ch.id}-banner` ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="mr-1 h-4 w-4" /> {t('changeBanner')}
                    </>
                  )}
                </span>
              </button>

              {/* AI banner: generate a properly-sized 6:1 header from the current
                  banner + an optional prompt. */}
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <input
                  value={bannerPrompt[ch.id] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBannerPrompt((p) => ({ ...p, [ch.id]: v }));
                  }}
                  maxLength={300}
                  placeholder={t('bannerPromptPlaceholder')}
                  disabled={genBanner === ch.id}
                  className="focus:ring-primary-500 h-8 flex-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs focus:ring-2 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void onGenerateBanner(ch)}
                  disabled={genBanner === ch.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                  title={t('generateHint')}
                >
                  {genBanner === ch.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {genBanner === ch.id ? t('generating') : t('generate')}
                </button>
              </div>

              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        pickImage(ch.id, 'avatar');
                      }}
                      disabled={uploading === `${ch.id}-avatar`}
                      className="relative -mt-10 h-14 w-14 overflow-hidden rounded-full border-2 border-white bg-gray-200"
                      title={t('uploadAvatar')}
                    >
                      {ch.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ch.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-gray-400">
                          <ImagePlus className="h-5 w-5" />
                        </span>
                      )}
                      {uploading === `${ch.id}-avatar` && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </span>
                      )}
                    </button>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{ch.name}</h3>
                      <p className="text-primary-600 text-sm">@{ch.handle}</p>
                      {ch.org_id && (
                        <p
                          className="mt-0.5 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800"
                          data-testid="channel-shared-badge"
                        >
                          {ch.team_name
                            ? t('teamPath', { org: ch.org_name ?? '', team: ch.team_name })
                            : ch.org_name}
                          {ch.can_manage === false ? t('canGoLive') : ''}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t('subscribers', { count: ch.subscriber_count })}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`/@${ch.handle}`}
                    className="text-primary-600 inline-flex items-center gap-1 text-sm hover:underline"
                  >
                    {t('view')} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <ChannelWebsiteEditor channelId={ch.id} initialUrl={ch.website_url} />

                <div className="mt-4 rounded-lg bg-gray-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                    <KeyRound className="h-3.5 w-3.5" /> {t('streamHeading')}
                  </div>
                  <label className="text-xs text-gray-500">{t('rtmpUrl')}</label>
                  <div className="mb-2 flex gap-2">
                    <input
                      readOnly
                      value={RTMP_INGEST_URL}
                      className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
                    />
                    <button
                      onClick={() => void copy(`url-${ch.id}`, RTMP_INGEST_URL)}
                      aria-label={t('copy')}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      {copied === `url-${ch.id}` ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <label className="text-xs text-gray-500">{t('streamKey')}</label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      type={show ? 'text' : 'password'}
                      value={ch.stream_key}
                      className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
                    />
                    <button
                      onClick={() => {
                        setRevealed((prev) => {
                          const next = new Set(prev);
                          if (next.has(ch.id)) next.delete(ch.id);
                          else next.add(ch.id);
                          return next;
                        });
                      }}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      {show ? t('hide') : t('show')}
                    </button>
                    <button
                      onClick={() => void copy(`key-${ch.id}`, ch.stream_key)}
                      aria-label={t('copy')}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      {copied === `key-${ch.id}` ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <RestreamManager channelId={ch.id} initialEnabled={ch.restream_enabled} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
          <Plus className="h-4 w-4" /> {t('newChannel')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{t('handle')}</label>
            <input
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
              }}
              maxLength={30}
              placeholder={t('handlePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{t('name')}</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={80}
              placeholder={t('namePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <WorkspacePicker
          orgs={orgs}
          value={owner}
          onChange={setOwner}
          requireManage
          label={t('belongsTo')}
          className="mt-3 text-xs font-medium"
        />
        <label className="mt-3 mb-1 block text-xs font-medium text-gray-700">
          {t('descriptionLabel')}
        </label>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          maxLength={500}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void create()}
          disabled={creating}
          className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('create')}
        </button>
      </div>
    </div>
  );
}
