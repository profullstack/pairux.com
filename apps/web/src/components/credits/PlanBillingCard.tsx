'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CreditCard, Gift, Ticket } from 'lucide-react';

interface PlanData {
  plan: string;
  effectivePlan: string;
  planExpiresAt: string | null;
}

const PLAN_NAME: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team' };

/**
 * Dashboard billing card: the plan in effect, when it ends, a "Have a code?"
 * redeem form (credit codes add plan days) and a link to /invites.
 */
export function PlanBillingCard() {
  const t = useTranslations('credits');
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/credits', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: PlanData };
      if (body.data) setPlan(body.data);
    } catch {
      /* keep the last value */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/credits/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { message: string };
        error?: string;
      };
      if (res.ok && body.data) {
        setMsg({ ok: true, text: body.data.message });
        setCode('');
        await load();
      } else {
        setMsg({ ok: false, text: body.error ?? t('redeemFailed') });
      }
    } catch {
      setMsg({ ok: false, text: t('redeemFailed') });
    } finally {
      setBusy(false);
    }
  }

  const active = plan?.effectivePlan ?? 'free';
  const ends =
    active !== 'free' && plan?.planExpiresAt
      ? new Date(plan.planExpiresAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6" id="billing">
      <div className="flex items-center gap-3">
        <CreditCard className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">{t('billingTitle')}</h2>
      </div>

      <div className="border-primary-200 bg-primary-50 mt-4 rounded-lg border-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-primary-700 font-semibold" data-testid="plan-name">
            {t('planName', { plan: PLAN_NAME[active] ?? active })}
          </span>
          <span className="bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-xs font-medium">
            {t('current')}
          </span>
        </div>
        {ends && (
          <p className="text-primary-600 mt-1 text-sm">{t('activeUntil', { date: ends })}</p>
        )}
        {active === 'free' && (
          <Link href="/pricing" className="text-primary-600 mt-1 inline-block text-sm underline">
            {t('seePlans')}
          </Link>
        )}
      </div>

      <form onSubmit={(e) => void redeem(e)} className="mt-5">
        <label
          htmlFor="credit-code"
          className="flex items-center gap-2 text-sm font-medium text-gray-700"
        >
          <Ticket className="h-4 w-4 text-gray-400" />
          {t('haveACode')}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="credit-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            placeholder="CR-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className="focus:border-primary-500 focus:ring-primary-500 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t('redeeming') : t('redeem')}
          </button>
        </div>
        {msg && (
          <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
            {msg.text}
          </p>
        )}
      </form>

      <Link
        href="/invites"
        className="mt-5 flex items-center gap-2 rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-50"
      >
        <Gift className="h-4 w-4 text-gray-400" />
        {t('inviteLink')}
      </Link>
    </div>
  );
}
