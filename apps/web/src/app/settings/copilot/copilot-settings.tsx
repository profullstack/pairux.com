'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, KeyRound, Loader2, Wallet } from 'lucide-react';
import {
  COPILOT_MODES,
  COPILOT_ROLES,
  type CopilotMode,
  type CopilotRole,
} from '@pairux/meeting-copilot/types';

const PROVIDERS = ['anthropic', 'openai', 'elevenlabs'] as const;
type Provider = (typeof PROVIDERS)[number];

interface Settings {
  mode: CopilotMode;
  role: CopilotRole;
  keys: Record<Provider, { set: boolean; last4: string | null }>;
  eligible: boolean;
  byokAvailable: boolean;
  balance: string;
}
interface WalletInfo {
  balance: string;
  topups: { id: string; priceUsd: number }[];
  usage: { provider: string; kind: string; charge: string; status: string; at: string }[];
}

async function read<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: string };
  if (!res.ok || !body.data)
    throw new Error(body.error ?? `Request failed (${String(res.status)})`);
  return body.data;
}

export function CopilotSettings({ header }: { header: ReactNode }) {
  const t = useTranslations('copilotPages');
  const c = useTranslations('copilot');
  const locale = useLocale();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<Provider, string>>({
    anthropic: '',
    openai: '',
    elevenlabs: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/copilot/settings');
      if (res.status === 401) {
        window.location.href = '/login?redirect=/settings/copilot';
        return;
      }
      setSettings(await read<Settings>(res));
      setWallet(await read<WalletInfo>(await fetch('/api/copilot/wallet')));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get('payment') === 'success')
      setMessage(t('topupPending'));
  }, [load, t]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await read(
        await fetch('/api/copilot/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
      );
      setMessage(t('saved'));
      setDrafts({ anthropic: '', openai: '', elevenlabs: '' });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const topup = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await read<{ checkout_url?: string; choose_method?: boolean }>(
        await fetch('/api/billing/copilot-topup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topup: id }),
        })
      );
      if (data.checkout_url) window.location.href = data.checkout_url;
      else setError(t('checkoutUnavailable'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const card = 'mt-6 rounded-xl border border-gray-200 bg-white p-5';
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/copilot" className="text-sm text-violet-700 hover:underline">
          ← {t('listTitle')}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Bot className="h-7 w-7 text-violet-600" aria-hidden="true" />
          {t('settingsTitle')}
        </h1>
        <p className="mt-2 text-gray-600">{c('pricingNote')}</p>
        {message && <p className="mt-4 text-green-700">{message}</p>}
        {error && <p className="mt-4 text-red-600">{error}</p>}
        {!settings && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}

        {settings && !settings.eligible && (
          <div className={card}>
            <p className="text-gray-800">{c('proOnly')}</p>
            <Link
              href="/upgrade/pro"
              className="mt-3 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white"
            >
              {c('upgrade')}
            </Link>
          </div>
        )}

        {settings && (
          <div className={card}>
            <label className="block">
              <span className="text-sm font-medium text-gray-800">{c('mode')}</span>
              <select
                value={settings.mode}
                disabled={busy}
                onChange={(event) => void save({ mode: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {COPILOT_MODES.map((id) => (
                  <option key={id} value={id}>
                    {c(`modes.${id}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-gray-800">{t('defaultRole')}</span>
              <select
                value={settings.role}
                disabled={busy}
                onChange={(event) => void save({ role: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {COPILOT_ROLES.map((id) => (
                  <option key={id} value={id}>
                    {c(`roles.${id}.label`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {settings && (
          <div className={card}>
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <KeyRound className="h-5 w-5 text-violet-600" aria-hidden="true" />
              {t('keysTitle')}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{t('keysIntro')}</p>
            {!settings.byokAvailable && (
              <p className="mt-2 text-sm text-amber-700">{t('keysDisabled')}</p>
            )}
            <div className="mt-4 space-y-3">
              {PROVIDERS.map((provider) => (
                <div key={provider} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-sm font-medium text-gray-800">
                    {t(`providers.${provider}`)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {settings.keys[provider].set
                      ? t('keySet', { last4: settings.keys[provider].last4 ?? '' })
                      : t('keyNotSet')}
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={drafts[provider]}
                    disabled={busy || !settings.byokAvailable}
                    onChange={(event) => {
                      setDrafts((all) => ({ ...all, [provider]: event.target.value }));
                    }}
                    placeholder={t('keyPlaceholder')}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy || !drafts[provider].trim()}
                    onClick={() => void save({ keys: { [provider]: drafts[provider].trim() } })}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {t('saveKey')}
                  </button>
                  {settings.keys[provider].set && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save({ keys: { [provider]: null } })}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
                    >
                      {t('removeKey')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {wallet && (
          <div className={card}>
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <Wallet className="h-5 w-5 text-violet-600" aria-hidden="true" />
              {t('walletTitle', { balance: wallet.balance })}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{t('walletIntro')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {wallet.topups.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void topup(one.id)}
                  className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                >
                  {t('addCredit', { amount: `$${String(one.priceUsd)}` })}
                </button>
              ))}
            </div>
            {wallet.usage.length > 0 && (
              <table className="mt-4 w-full text-left text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1 font-medium">{t('usageWhen')}</th>
                    <th className="py-1 font-medium">{t('usageWhat')}</th>
                    <th className="py-1 text-right font-medium">{t('usageCharge')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.usage.map((row, index) => (
                    <tr key={index} className="border-t border-gray-100">
                      <td className="py-1 text-gray-600">
                        {new Date(row.at).toLocaleString(locale)}
                      </td>
                      <td className="py-1 text-gray-800">
                        {row.provider} · {row.kind}
                        {row.status === 'refunded' && ` (${t('refunded')})`}
                      </td>
                      <td className="py-1 text-right text-gray-800">{row.charge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
