'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Gift, Link2 } from 'lucide-react';

interface InviteRow {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  status: 'open' | 'used' | 'expired' | 'revoked';
  note: string;
  usedByName?: string | null;
  bonus?: 'granted' | 'denied' | 'pending';
}

interface Overview {
  quota: { total: number; used: number; left: number };
  invites: InviteRow[];
  canInvite: boolean;
  unlocksAt: string | null;
  bonusDays: number;
  refLink: string;
}

function day(ms: number | string) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** /invites: three scarce invites per account, plus the open ?ref= link. */
export function InvitesManager() {
  const t = useTranslations('credits.invites');
  const [o, setO] = useState<Overview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/invites', { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { data?: Overview; error?: string };
    if (body.data) setO(body.data);
    else setError(body.error ?? t('loadFailed'));
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { code: string; url: string };
        error?: string;
      };
      if (body.data) {
        setFresh(body.data);
        setNote('');
        await load();
      } else setError(body.error ?? t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? t('revokeFailed'));
    }
    await load();
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => {
        setCopied(null);
      }, 1500);
    });
  }

  if (!o) {
    return <p className="text-gray-500">{error ?? t('loading')}</p>;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <Gift className="text-primary-600 h-5 w-5" />
          <h2 className="text-lg font-semibold text-gray-900">
            {t('left', { left: o.quota.left, total: o.quota.total })}
          </h2>
        </div>
        <p className="mt-2 text-sm text-gray-600">{t('explain', { days: o.bonusDays })}</p>

        {o.canInvite ? (
          o.quota.left > 0 ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                maxLength={200}
                placeholder={t('notePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void create()}
                disabled={busy}
                className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t('create')}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">{t('noneLeft')}</p>
          )
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            {o.unlocksAt ? t('unlocks', { date: day(o.unlocksAt) }) : t('locked')}
          </p>
        )}

        {fresh && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">{t('shownOnce')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-sm text-green-900">{fresh.url}</code>
              <button
                onClick={() => {
                  copy(fresh.url);
                }}
                className="rounded p-1 text-green-800 hover:bg-green-100"
                aria-label={t('copy')}
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 font-mono text-xs text-green-700">{fresh.code}</p>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      {o.invites.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">{t('sent')}</h2>
          <ul className="mt-4 divide-y divide-gray-100">
            {o.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-gray-900">{i.note || t('noNote')}</p>
                  <p className="text-gray-500">
                    {t(`status.${i.status}`)}
                    {i.status === 'used' && i.usedByName ? ` · ${i.usedByName}` : ''}
                    {i.bonus ? ` · ${t(`bonus.${i.bonus}`, { days: o.bonusDays })}` : ''}
                    {i.status === 'open' && i.expiresAt
                      ? ` · ${t('expires', { date: day(i.expiresAt) })}`
                      : ''}
                  </p>
                </div>
                {i.status === 'open' && (
                  <button
                    onClick={() => void revoke(i.id)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1 text-gray-600 hover:bg-gray-50"
                  >
                    {t('withdraw')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">{t('refTitle')}</h2>
        </div>
        <p className="mt-2 text-sm text-gray-600">{t('refExplain')}</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-gray-50 px-3 py-2 font-mono text-sm">
            {o.refLink}
          </code>
          <button
            onClick={() => {
              copy(o.refLink);
            }}
            className="rounded p-2 text-gray-600 hover:bg-gray-100"
            aria-label={t('copy')}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        {copied && <p className="mt-2 text-xs text-green-700">{t('copied')}</p>}
      </section>
    </div>
  );
}
