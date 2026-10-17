'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Sparkles, Users, X } from 'lucide-react';
import type { Plan, SeatKind } from '@pairux/shared-types';
import { PLANS, TERM_DAYS, type PaidPlan } from '@/lib/plans';
import { useCheckout } from './useCheckout';

interface UpgradePromptProps {
  /** Which limit was hit: the room's seat cap, or a Pro-only feature. */
  reason: 'roomFull' | 'proFeature';
  /** The plan that lifts the limit (what the button buys). */
  plan: PaidPlan;
  /** The host's current plan (roomFull only). */
  currentPlan?: Plan;
  /** Which seats ran out (roomFull only): talking participants or listeners. */
  seats?: SeatKind;
  /** Seats of that kind on the current plan (roomFull only). */
  cap?: number;
  /** How many joiners have been turned away so far (roomFull only). */
  refused?: number;
  /** Where a signed-out buyer comes back to after login. */
  returnTo: string;
  onDismiss?: () => void;
  /** 'dark' on the host call screen, 'light' on regular pages. */
  tone?: 'dark' | 'light';
}

/**
 * The upgrade moment: names the limit the host just hit, the plan that lifts
 * it and its price, and starts the CoinPay checkout in one click. Shown only
 * to the host (the payer), never to a guest.
 */
export function UpgradePrompt({
  reason,
  plan,
  currentPlan = 'free',
  seats: seatKind = 'participants',
  cap,
  refused = 0,
  returnTo,
  onDismiss,
  tone = 'light',
}: UpgradePromptProps) {
  const t = useTranslations('upgradePrompt');
  const tiers = useTranslations('pricing.tiers');
  const format = useFormatter();
  const { start, loading, error } = useCheckout();

  const def = PLANS[plan];
  const planName = tiers(`${plan}.name`);
  const price = format.number(def.priceUsd, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(def.priceUsd) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const listenerSeats = format.number(def.listeners);
  const roomFullListeners = reason === 'roomFull' && seatKind === 'listeners';

  const dark = tone === 'dark';
  const Icon = reason === 'roomFull' ? Users : Sparkles;

  return (
    <div
      role="alert"
      data-testid="upgrade-prompt"
      className={`relative rounded-xl border p-4 shadow-lg ${
        dark ? 'border-amber-500/40 bg-gray-800 text-gray-100' : 'border-amber-300 bg-amber-50'
      }`}
    >
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('dismiss')}
          className={`absolute top-3 right-3 rounded p-1 ${
            dark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3 pr-6">
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className={`font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>
            {reason === 'roomFull' ? t('roomFullTitle') : t('proFeatureTitle')}
          </p>
          <p className={`mt-1 text-sm ${dark ? 'text-gray-300' : 'text-gray-700'}`}>
            {reason === 'roomFull'
              ? t(roomFullListeners ? 'roomFullBody' : 'participantsFullBody', {
                  cap: format.number(cap ?? 0),
                  current: tiers(`${currentPlan}.name`),
                })
              : null}
            {reason === 'roomFull' && refused > 0
              ? ` ${t('turnedAway', { count: refused })}`
              : null}
            {reason === 'roomFull' ? ' ' : null}
            {reason !== 'roomFull'
              ? t('proFeatureBody', { plan: planName, seats: listenerSeats, price })
              : roomFullListeners
                ? t('roomFullLift', { plan: planName, seats: listenerSeats, price })
                : t('participantsFullLift', {
                    plan: planName,
                    seats: format.number(def.participants),
                    price,
                  })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void start(plan, returnTo)}
              disabled={loading}
              data-testid="upgrade-prompt-cta"
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? t('starting') : t('cta', { plan: planName, price })}
            </button>
            <span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('payNote', { days: TERM_DAYS })}
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}
