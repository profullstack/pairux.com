/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unnecessary-condition */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  createIntegration,
  revokeIntegration,
  type IntegrationKind,
} from '@/app/actions/integrations';

interface Integration {
  id: string;
  name: string;
  kind: IntegrationKind;
  access_token: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
}

const KIND_META: Record<IntegrationKind, { label: string }> = {
  outrank: { label: 'Outrank' },
  crawlproof: { label: 'Crawlproof' },
};

export function IntegrationsManager({ initial }: { initial: Integration[] }) {
  const t = useTranslations('admin.integrations');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [items, setItems] = useState<Integration[]>(initial);
  const [kind, setKind] = useState<IntegrationKind>('crawlproof');
  const [name, setName] = useState('Crawlproof');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/api/webhooks/autoblog`;

  const onCreate = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setJustCreatedToken(null);
    start(async () => {
      const res = await createIntegration({ name, kind });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setJustCreatedToken(res.accessToken);
      setName(kind === 'crawlproof' ? 'Crawlproof' : 'Outrank');
      router.refresh();
    });
  };

  const onRevoke = (it: Integration) => {
    if (!confirm(t('confirmRevoke', { name: it.name }))) return;
    start(async () => {
      const res = await revokeIntegration({ id: it.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== it.id));
      router.refresh();
    });
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => {
      setCopied(null);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
          {t('webhookEndpoint')}
        </p>
        <div className="flex gap-2">
          <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs break-all">
            {webhookUrl || 'https://pairux.com/api/webhooks/autoblog'}
          </code>
          <button
            type="button"
            onClick={() => {
              copy('url', webhookUrl);
            }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
          >
            {copied === 'url' ? t('copied') : t('copy')}
          </button>
        </div>
      </div>

      <form onSubmit={onCreate}>
        <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
          {t('generateToken')}
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as IntegrationKind;
              setKind(k);
              setName(k === 'crawlproof' ? 'Crawlproof' : 'Outrank');
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="crawlproof">Crawlproof</option>
            <option value="outrank">Outrank</option>
          </select>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder={t('namePlaceholder')}
            maxLength={100}
            required
            className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {pending ? '…' : t('generate')}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {justCreatedToken && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="mb-2 text-xs font-semibold text-green-700">{t('tokenCreated')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all">{justCreatedToken}</code>
              <button
                type="button"
                onClick={() => {
                  copy('new', justCreatedToken);
                }}
                className="rounded border border-green-300 px-2 py-1 text-xs hover:bg-green-100"
              >
                {copied === 'new' ? t('copied') : t('copy')}
              </button>
            </div>
          </div>
        )}
      </form>

      <div>
        <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
          {t('accessTokens', { count: items.length })}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const show = !!revealed[it.id];
              const masked = `${it.access_token.slice(0, 8)}…${it.access_token.slice(-4)}`;
              return (
                <li key={it.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-gray-900">{it.name}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {KIND_META[it.kind]?.label ?? it.kind}
                        </span>
                        <span className="text-xs text-gray-500">
                          {t('requests', { count: it.request_count })}
                          {it.last_used_at &&
                            ` · ${t('lastUsed', { date: new Date(it.last_used_at).toLocaleString(locale) })}`}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs break-all">
                          {show ? it.access_token : masked}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            setRevealed((p) => ({ ...p, [it.id]: !p[it.id] }));
                          }}
                          className="text-xs text-gray-500 hover:text-gray-900"
                        >
                          {show ? t('hide') : t('reveal')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            copy(it.id, it.access_token);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-900"
                        >
                          {copied === it.id ? t('copied') : t('copy')}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onRevoke(it);
                      }}
                      disabled={pending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      {t('revoke')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
