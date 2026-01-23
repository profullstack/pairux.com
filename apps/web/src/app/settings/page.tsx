import type { Metadata } from 'next';
import Link from 'next/link';
import {
  User,
  Bell,
  Shield,
  Palette,
  Monitor,
  KeyRound,
  CreditCard,
  HelpCircle,
  ChevronRight,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Settings - Coming Soon',
  description: 'PairUX Settings - Manage your account, preferences, and security.',
};

const settingsSections = [
  {
    title: 'Account',
    description: 'Manage your profile and account details',
    icon: User,
    items: [
      { label: 'Profile Information', description: 'Update your name and email' },
      { label: 'Password', description: 'Change your password' },
      { label: 'Connected Accounts', description: 'Manage OAuth connections' },
    ],
  },
  {
    title: 'Notifications',
    description: 'Control how you receive updates',
    icon: Bell,
    items: [
      { label: 'Email Notifications', description: 'Session invites and updates' },
      { label: 'Desktop Notifications', description: 'Control request alerts' },
      { label: 'Marketing', description: 'Product news and tips' },
    ],
  },
  {
    title: 'Privacy & Security',
    description: 'Protect your account and data',
    icon: Shield,
    items: [
      { label: 'Two-Factor Authentication', description: 'Add an extra layer of security' },
      { label: 'Session History', description: 'View and manage active sessions' },
      { label: 'Data & Privacy', description: 'Download or delete your data' },
    ],
  },
  {
    title: 'Appearance',
    description: 'Customize your experience',
    icon: Palette,
    items: [
      { label: 'Theme', description: 'Light, dark, or system' },
      { label: 'Language', description: 'Choose your preferred language' },
    ],
  },
  {
    title: 'Desktop App',
    description: 'Configure desktop app settings',
    icon: Monitor,
    items: [
      { label: 'Startup', description: 'Launch on system startup' },
      { label: 'Hotkeys', description: 'Customize keyboard shortcuts' },
      { label: 'Recording', description: 'Default recording settings' },
      { label: 'RTMP Streaming', description: 'Manage stream destinations' },
    ],
  },
  {
    title: 'API & Integrations',
    description: 'Manage API access and integrations',
    icon: KeyRound,
    items: [
      { label: 'API Keys', description: 'Generate and manage API keys' },
      { label: 'Webhooks', description: 'Configure event webhooks' },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Coming Soon Banner */}
          <div className="from-primary-600 to-primary-700 mb-8 rounded-xl bg-gradient-to-r p-6 text-center text-white shadow-lg">
            <h1 className="text-3xl font-bold">Settings Coming Soon</h1>
            <p className="text-primary-100 mt-2">
              We&apos;re building a comprehensive settings experience. Check back soon!
            </p>
            <div className="mt-4 flex justify-center gap-4">
              <Link
                href="/download"
                className="text-primary-600 hover:bg-primary-50 rounded-lg bg-white px-6 py-2 font-semibold transition-colors"
              >
                Download App
              </Link>
              <Link
                href="/dashboard"
                className="rounded-lg border border-white/30 px-6 py-2 font-semibold text-white transition-colors hover:bg-white/10"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>

          {/* Quick Links */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
              <div className="flex items-center gap-4">
                <div className="bg-primary-100 flex h-12 w-12 items-center justify-center rounded-lg">
                  <CreditCard className="text-primary-600 h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Billing & Plans</p>
                  <p className="text-sm text-gray-500">Manage subscription</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 opacity-50 grayscale">
              <div className="flex items-center gap-4">
                <div className="bg-accent-100 flex h-12 w-12 items-center justify-center rounded-lg">
                  <HelpCircle className="text-accent-600 h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Help & Support</p>
                  <p className="text-sm text-gray-500">Get assistance</p>
                </div>
              </div>
            </div>
          </div>

          {/* Settings Sections */}
          <div className="space-y-6">
            {settingsSections.map((section) => (
              <div
                key={section.title}
                className="rounded-xl border border-gray-200 bg-white opacity-50 grayscale"
              >
                <div className="border-b border-gray-100 p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                      <section.icon className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900">{section.title}</h2>
                      <p className="text-sm text-gray-500">{section.description}</p>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      disabled
                      className="flex w-full cursor-not-allowed items-center justify-between p-4 text-left hover:bg-gray-50"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{item.label}</p>
                        <p className="text-sm text-gray-500">{item.description}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Danger Zone */}
          <div className="mt-8 rounded-xl border border-red-200 bg-white opacity-50 grayscale">
            <div className="border-b border-red-100 p-6">
              <h2 className="font-semibold text-red-600">Danger Zone</h2>
              <p className="text-sm text-gray-500">Irreversible actions</p>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Delete Account</p>
                  <p className="text-sm text-gray-500">
                    Permanently delete your account and all associated data
                  </p>
                </div>
                <button
                  disabled
                  className="cursor-not-allowed rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600"
                >
                  Delete Account
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
