import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Monitor, Users, Clock, CreditCard, BarChart3, Settings, Bell } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Dashboard - Coming Soon',
  description: 'PairUX Dashboard - Manage your sessions, billing, and settings.',
};

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Personal use & small teams',
    features: ['2 participants + 5 viewers', 'P2P connections', 'Screen sharing', 'Remote control'],
    current: true,
  },
  {
    name: 'Pro',
    price: '$12',
    period: '/month',
    description: 'For professionals & growing teams',
    features: ['10 participants + 50 viewers', '100 viewer-hours included', '+$0.08/hr overage', 'HD 1080p'],
    current: false,
  },
  {
    name: 'Team',
    price: '$49',
    period: '/month',
    description: 'For teams & organizations',
    features: ['Unlimited participants', '500 viewer-hours included', '+$0.08/hr overage', '4K streaming'],
    current: false,
  },
];

const stats = [
  { label: 'Sessions This Month', value: '0', icon: Monitor },
  { label: 'Total Participants', value: '0', icon: Users },
  { label: 'Hours Used', value: '0h', icon: Clock },
];

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Coming Soon Banner */}
          <div className="mb-8 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-center text-white shadow-lg">
            <h1 className="text-3xl font-bold">Dashboard Coming Soon</h1>
            <p className="mt-2 text-primary-100">
              We&apos;re building something amazing. Get early access by signing up for updates.
            </p>
            <div className="mt-4 flex justify-center gap-4">
              <Link
                href="/download"
                className="rounded-lg bg-white px-6 py-2 font-semibold text-primary-600 transition-colors hover:bg-primary-50"
              >
                Download App
              </Link>
            </div>
          </div>

          {/* Stats Preview (Greyed Out) */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                    <stat.icon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Main Content Grid */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Left Column - Quick Actions */}
            <div className="lg:col-span-2 space-y-6">
              {/* Quick Actions (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <button
                    disabled
                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left cursor-not-allowed"
                  >
                    <Monitor className="h-8 w-8 text-primary-600" />
                    <div>
                      <p className="font-semibold text-gray-900">Start Session</p>
                      <p className="text-sm text-gray-500">Share your screen</p>
                    </div>
                  </button>
                  <button
                    disabled
                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left cursor-not-allowed"
                  >
                    <Users className="h-8 w-8 text-accent-600" />
                    <div>
                      <p className="font-semibold text-gray-900">Join Session</p>
                      <p className="text-sm text-gray-500">Enter a join code</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Recent Sessions (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
                <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
                  <Monitor className="h-12 w-12 text-gray-300" />
                  <p className="mt-4 text-gray-500">No sessions yet</p>
                  <p className="text-sm text-gray-400">Start your first session to see it here</p>
                </div>
              </div>

              {/* Usage Analytics (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Usage Analytics</h2>
                  <BarChart3 className="h-5 w-5 text-gray-400" />
                </div>
                <div className="mt-4 h-48 flex items-center justify-center rounded-lg bg-gray-50">
                  <p className="text-gray-400">Analytics will appear here</p>
                </div>
              </div>
            </div>

            {/* Right Column - Plan & Settings */}
            <div className="space-y-6">
              {/* Current Plan */}
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">Your Plan</h2>
                <div className="mt-4 rounded-lg border-2 border-primary-200 bg-primary-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-primary-700">Free Plan</span>
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                      Current
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-primary-600">2 participants, P2P only</p>
                </div>
              </div>

              {/* Upgrade Options (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">Upgrade Plan</h2>
                <p className="mt-1 text-sm text-gray-500">Coming soon</p>
                <div className="mt-4 space-y-4">
                  {plans.slice(1).map((plan) => (
                    <div
                      key={plan.name}
                      className="rounded-lg border border-gray-200 p-4 opacity-50 grayscale"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{plan.name}</p>
                          <p className="text-sm text-gray-500">{plan.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-900">{plan.price}</p>
                          <p className="text-xs text-gray-500">{plan.period}</p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1">
                        {plan.features.slice(0, 2).map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
                            <Check className="h-4 w-4 text-gray-400" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <button
                        disabled
                        className="mt-4 w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
                      >
                        Coming Soon
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Billing (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-gray-400" />
                  <h2 className="text-lg font-semibold text-gray-900">Billing</h2>
                </div>
                <p className="mt-2 text-sm text-gray-500">No payment method on file</p>
                <button
                  disabled
                  className="mt-4 w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
                >
                  Add Payment Method
                </button>
              </div>

              {/* Settings Links (Greyed Out) */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
                <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
                <div className="mt-4 space-y-2">
                  <button
                    disabled
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left cursor-not-allowed hover:bg-gray-50"
                  >
                    <Settings className="h-5 w-5 text-gray-400" />
                    <span className="text-gray-600">Account Settings</span>
                  </button>
                  <button
                    disabled
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left cursor-not-allowed hover:bg-gray-50"
                  >
                    <Bell className="h-5 w-5 text-gray-400" />
                    <span className="text-gray-600">Notifications</span>
                  </button>
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
