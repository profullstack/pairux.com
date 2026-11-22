'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Radio, Check, Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const EARN_URL = 'https://c0mpute.com/r/2jnqwsne';
const DEFAULT_TOP_UP_URL = 'https://c0mpute.com/dashboard/live';

interface C0Channel {
  channelId: string;
  handle: string | null;
  name: string | null;
  watchUrl: string | null;
  restreamEnabled: boolean | null;
}

interface C0Status {
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
  tier: 'paid' | 'free' | null;
  topUpUrl: string | null;
  channels: C0Channel[];
}

type NoticeKey =
  'justConnected' | 'partial' | 'noChannels' | 'scope' | 'unavailable' | 'keyFormat' | 'failed';
type Notice = { kind: 'ok' | 'error'; key: NoticeKey } | null;

/** The `?c0mpute=` result codes the c0mpute routes redirect with, as message keys. */
export function c0mputeNoticeKey(code: string | null | undefined): Notice {
  if (!code) return null;
  switch (code) {
    case 'connected':
      return { kind: 'ok', key: 'justConnected' };
    case 'partial':
      return { kind: 'error', key: 'partial' };
    case 'nochannels':
      return { kind: 'error', key: 'noChannels' };
    case 'scope':
      return { kind: 'error', key: 'scope' };
    case 'unavailable':
      return { kind: 'error', key: 'unavailable' };
    case 'format':
      return { kind: 'error', key: 'keyFormat' };
    default:
      return { kind: 'error', key: 'failed' };
  }
}

/** Only https links are rendered; anything else falls back to the c0mpute dashboard. */
function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Connect c0mpute Live: restream every channel's lives into the c0mpute p2p
 * network. Connecting (OAuth or a pasted API key) sets up one c0mpute stream
 * per channel; the credential itself is not kept.
 */
export function C0mputeConnect() {
  const t = useTranslations('settings.c0mpute');
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<C0Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(() => c0mputeNoticeKey(searchParams.get('c0mpute')));
  const [tier, setTier] = useState<'paid' | 'free' | null>(() => {
    const q = searchParams.get('tier');
    return q === 'paid' || q === 'free' ? q : null;
  });
  const [topUpUrl, setTopUpUrl] = useState<string>(DEFAULT_TOP_UP_URL);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/c0mpute/status');
      if (res.ok) {
        const json = (await res.json()) as { data: C0Status };
        setStatus(json.data);
      }
    } catch {
      // leave status null
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitKey = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/c0mpute/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        code?: string;
        data?: { outcome: string; tier: 'paid' | 'free' | null; topUpUrl: string | null };
      };
      // The key is spent either way: do not keep it in the page.
      setApiKey('');
      if (!res.ok || !json.data) {
        setNotice(c0mputeNoticeKey(json.code ?? 'failed'));
        return;
      }
      setNotice(c0mputeNoticeKey(json.data.outcome));
      setTier(json.data.tier);
      setTopUpUrl(safeHttps(json.data.topUpUrl) ?? DEFAULT_TOP_UP_URL);
      setShowKey(false);
      await load();
    } catch {
      setNotice(c0mputeNoticeKey('failed'));
    } finally {
      setBusy(false);
    }
  }, [apiKey, load]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/c0mpute/disconnect', { method: 'POST' });
      if (!res.ok) setNotice(c0mputeNoticeKey('failed'));
      setTier(null);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => {
        setCopied((c) => (c === url ? null : c));
      }, 2000);
    } catch {
      // clipboard blocked: the link is still on screen to select
    }
  }, []);

  const connectButton = (label: string, primary: boolean) => (
    <a
      href="/api/v1/c0mpute/oauth/start"
      className={
        primary
          ? 'inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800'
          : 'inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100'
      }
    >
      {label}
    </a>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white" id="c0mpute">
      <div className="border-b border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Radio className="h-5 w-5 text-gray-700" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t('title')}</h2>
            <p className="text-sm text-gray-500">{t('description')}</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 p-6">
        <p className="text-sm text-gray-600">{t('pricing')}</p>
        {notice && (
          <p
            className={`text-sm ${notice.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}
            role="status"
          >
            {t(notice.key)}
          </p>
        )}

        {status === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : status.connected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                {status.accountLabel
                  ? t('connectedAs', { account: status.accountLabel })
                  : t('connected')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {connectButton(t('resync'), false)}
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('disconnect')}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-900">{t('watchLinks')}</h3>
              <ul className="mt-2 space-y-2">
                {status.channels.map((c) => {
                  const watch = safeHttps(c.watchUrl);
                  return (
                    <li
                      key={c.channelId}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-800">
                          {c.name ?? c.handle ?? c.channelId}
                        </span>
                        {watch && (
                          <>
                            <a
                              href={watch}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary-600 min-w-0 flex-1 truncate hover:underline"
                            >
                              {watch}
                            </a>
                            <button
                              type="button"
                              onClick={() => void copy(watch)}
                              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                            >
                              {copied === watch ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              {copied === watch ? t('copied') : t('copy')}
                            </button>
                          </>
                        )}
                      </div>
                      {c.restreamEnabled === false && (
                        <p className="mt-1 text-xs text-amber-700">{t('restreamOff')}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="text-sm text-gray-600">
              {tier === 'paid' ? t('tierPaid') : tier === 'free' ? t('tierFree') : null}{' '}
              <a
                href={topUpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 font-medium hover:underline"
              >
                {t('topUp')}
              </a>
            </p>
          </div>
        ) : !status.configured ? (
          <p className="text-sm text-gray-500">{t('unavailable')}</p>
        ) : (
          <div className="space-y-3">
            {connectButton(t('connect'), true)}
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowKey((v) => !v);
                }}
                aria-expanded={showKey}
                className="text-sm text-gray-600 underline hover:text-gray-900"
              >
                {t('pasteToggle')}
              </button>
              {showKey && (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitKey();
                  }}
                >
                  <label htmlFor="c0mpute-api-key" className="block text-sm text-gray-700">
                    {t('keyLabel')}
                  </label>
                  <input
                    id="c0mpute-api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                    }}
                    placeholder="c0k_..."
                    className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                  />
                  <p className="text-xs text-gray-500">{t('keyHint')}</p>
                  <button
                    type="submit"
                    disabled={busy || !apiKey.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('keySubmit')}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <p className="text-sm">
          <a
            href={EARN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 font-medium hover:underline"
          >
            {t('earn')}
          </a>
        </p>
      </div>
    </div>
  );
}
