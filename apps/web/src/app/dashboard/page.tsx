import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Clock, Monitor, Users, BarChart3, Settings, Bell, Radio } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DashboardClient } from './components/DashboardClient';
import { ChannelsManager } from './ChannelsManager';
import { PlanBillingCard } from '@/components/credits/PlanBillingCard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard.metadata');
  return { title: t('title'), description: t('description') };
}

// Upgrade options shown on the dashboard (copy lives under dashboard.plans.*).
const plans = [
  { key: 'pro', name: 'Pro', price: '$12', features: ['participants', 'hours'] },
  { key: 'team', name: 'Team', price: '$49', features: ['participants', 'hours'] },
] as const;

const stats = [
  { key: 'sessionsThisMonth', value: 0, icon: Monitor },
  { key: 'totalParticipants', value: 0, icon: Users },
  { key: 'hoursUsed', value: 0, icon: Clock },
] as const;

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Stats Preview (Greyed Out) */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.key}
                className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                    <stat.icon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{t(`stats.${stat.key}`)}</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {stat.key === 'hoursUsed'
                        ? t('stats.hoursValue', { hours: stat.value })
                        : stat.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Channels — create/manage channels + get RTMP stream keys */}
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              <h2 className="text-xl font-bold text-gray-900">{t('channelsHeading')}</h2>
            </div>
            <ChannelsManager />
          </div>

          <div className="grid gap-8 lg:grid-cols-3">
            {/* Left Column — interactive (client component) */}
            <div className="space-y-6 lg:col-span-2">
              <DashboardClient />

              {/* Usage Analytics (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{t('usageAnalytics')}</h2>
                  <BarChart3 className="h-5 w-5 text-gray-400" />
                </div>
                <div className="mt-4 flex h-48 items-center justify-center rounded-lg bg-gray-50">
                  <p className="text-gray-400">{t('analyticsPlaceholder')}</p>
                </div>
              </div>
            </div>

            {/* Right Column - Plan & Settings */}
            <div className="space-y-6">
              {/* Plan, end date, "Have a code?" and invites */}
              <PlanBillingCard />

              {/* Upgrade Options (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">{t('upgradePlan')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('comingSoon')}</p>
                <div className="mt-4 space-y-4">
                  {plans.map((plan) => (
                    <div
                      key={plan.key}
                      className="rounded-lg border border-gray-200 p-4 opacity-50 grayscale"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{plan.name}</p>
                          <p className="text-sm text-gray-500">
                            {t(`plans.${plan.key}.description`)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-900">{plan.price}</p>
                          <p className="text-xs text-gray-500">{t('perMonth')}</p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1">
                        {plan.features.map((feature) => (
                          <li
                            key={feature}
                            className="flex items-center gap-2 text-sm text-gray-600"
                          >
                            <Check className="h-4 w-4 text-gray-400" />
                            {t(`plans.${plan.key}.features.${feature}`)}
                          </li>
                        ))}
                      </ul>
                      <button
                        disabled
                        className="mt-4 w-full cursor-not-allowed rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-400"
                      >
                        {t('comingSoonButton')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settings Links */}
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">{t('settings')}</h2>
                <div className="mt-4 space-y-2">
                  <Link
                    href="/settings"
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-50"
                  >
                    <Settings className="h-5 w-5 text-gray-400" />
                    <span className="text-gray-600">{t('accountSettings')}</span>
                  </Link>
                  <Link
                    href="/settings#notifications"
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-50"
                  >
                    <Bell className="h-5 w-5 text-gray-400" />
                    <span className="text-gray-600">{t('notifications')}</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
