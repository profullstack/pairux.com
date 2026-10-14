'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { User, Video, Users, Palette, Info, ArrowLeft, Check, Bell, Languages } from 'lucide-react';
import { HeaderClient } from '@/components/header-client';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NotificationPreferences } from '@/components/notifications/NotificationPreferences';
import { YouTubeConnect } from './youtube-connect';
import type { UserData } from '@/components/header';
import type { RecordingQuality } from '@/hooks/useRecording';
import type { CaptureQuality } from '@/hooks/useScreenCapture';

interface AppSettings {
  recording: {
    defaultQuality: RecordingQuality;
  };
  capture: {
    defaultQuality: CaptureQuality;
    includeAudio: boolean;
  };
  session: {
    defaultMaxParticipants: number;
    /** Try the desktop app before hosting a session in this browser. */
    openInDesktopApp: boolean;
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  recording: {
    defaultQuality: '1080p',
  },
  capture: {
    defaultQuality: '1080p',
    includeAudio: true,
  },
  session: {
    defaultMaxParticipants: 5,
    openInDesktopApp: true,
  },
  appearance: {
    theme: 'system',
  },
};

// Local storage key for settings
const SETTINGS_KEY = 'pairux-web-settings';

export function SettingsContent({
  user,
  footer,
}: {
  user: UserData | null;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('settings');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as Partial<AppSettings>;
        setSettings((prev) => ({
          ...prev,
          ...parsed,
          recording: { ...prev.recording, ...parsed.recording },
          capture: { ...prev.capture, ...parsed.capture },
          session: { ...prev.session, ...parsed.session },
          appearance: { ...prev.appearance, ...parsed.appearance },
        }));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
    }, 2000);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <HeaderClient user={user} />

      <main className="flex-1 py-8">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <Check className="h-4 w-4" />
                {t('saved')}
              </span>
            )}
          </div>

          <div className="space-y-6">
            {/* YouTube auto go-live */}
            <YouTubeConnect />

            {/* Account Section */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <User className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('account.title')}</h2>
                    <p className="text-sm text-gray-500">{t('account.description')}</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                {user ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{t('account.email')}</span> {user.email}
                    </p>
                    {(user.firstName || user.lastName) && (
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{t('account.name')}</span> {user.firstName}{' '}
                        {user.lastName}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">{t('account.signInPrompt')}</p>
                    <div className="mt-4 flex gap-3">
                      <Link
                        href="/login"
                        className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                      >
                        {t('account.signIn')}
                      </Link>
                      <Link
                        href="/signup"
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        {t('account.createAccount')}
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Recording Settings */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Video className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('recording.title')}</h2>
                    <p className="text-sm text-gray-500">{t('recording.description')}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 p-6">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {t('recording.defaultRecordingQuality')}
                  </label>
                  <select
                    value={settings.recording.defaultQuality}
                    onChange={(e) => {
                      saveSettings({
                        ...settings,
                        recording: {
                          ...settings.recording,
                          defaultQuality: e.target.value as RecordingQuality,
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="720p">{t('quality.720p')}</option>
                    <option value="1080p">{t('quality.1080p')}</option>
                    <option value="4k">{t('quality.4k')}</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('recording.recordingQualityHint')}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {t('recording.defaultCaptureQuality')}
                  </label>
                  <select
                    value={settings.capture.defaultQuality}
                    onChange={(e) => {
                      saveSettings({
                        ...settings,
                        capture: {
                          ...settings.capture,
                          defaultQuality: e.target.value as CaptureQuality,
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="720p">{t('quality.720p')}</option>
                    <option value="1080p">{t('quality.1080p')}</option>
                    <option value="4k">{t('quality.4k')}</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">{t('recording.captureQualityHint')}</p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {t('recording.includeSystemAudio')}
                    </p>
                    <p className="text-xs text-gray-500">{t('recording.includeSystemAudioHint')}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t('recording.includeSystemAudio')}
                    aria-pressed={settings.capture.includeAudio}
                    onClick={() => {
                      saveSettings({
                        ...settings,
                        capture: {
                          ...settings.capture,
                          includeAudio: !settings.capture.includeAudio,
                        },
                      });
                    }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      settings.capture.includeAudio ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        settings.capture.includeAudio ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-lg bg-blue-50 p-4">
                  <p className="text-sm text-blue-800">
                    {t.rich('recording.webRecordingNote', {
                      strong: (chunks) => <strong>{chunks}</strong>,
                      link: (chunks) => (
                        <Link href="/download" className="underline hover:text-blue-900">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Session Defaults */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Users className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('session.title')}</h2>
                    <p className="text-sm text-gray-500">{t('session.description')}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 p-6">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {t('session.maxParticipants')}
                  </label>
                  <select
                    value={settings.session.defaultMaxParticipants}
                    onChange={(e) => {
                      saveSettings({
                        ...settings,
                        session: {
                          ...settings.session,
                          defaultMaxParticipants: parseInt(e.target.value, 10),
                        },
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {[2, 5, 10].map((count) => (
                      <option key={count} value={count}>
                        {t('session.viewers', { count })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {t('session.openInDesktopApp')}
                    </p>
                    <p className="text-xs text-gray-500">{t('session.openInDesktopAppHint')}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t('session.openInDesktopAppAria')}
                    aria-pressed={settings.session.openInDesktopApp}
                    onClick={() => {
                      saveSettings({
                        ...settings,
                        session: {
                          ...settings.session,
                          openInDesktopApp: !settings.session.openInDesktopApp,
                        },
                      });
                    }}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      settings.session.openInDesktopApp ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        settings.session.openInDesktopApp ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                  <p className="text-sm text-yellow-800">
                    {t.rich('session.remoteControlNote', {
                      strong: (chunks) => <strong>{chunks}</strong>,
                      link: (chunks) => (
                        <Link href="/download" className="underline hover:text-yellow-900">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div id="notifications" className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Bell className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('notifications.title')}</h2>
                    <p className="text-sm text-gray-500">{t('notifications.description')}</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <NotificationPreferences />
              </div>
            </div>

            {/* Language */}
            <div id="language" className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Languages className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('language.title')}</h2>
                    <p className="text-sm text-gray-500">{t('language.description')}</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <LanguageSwitcher id="language-switcher-settings" showLabel />
                <p className="mt-2 text-xs text-gray-500">{t('language.hint')}</p>
              </div>
            </div>

            {/* Appearance */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Palette className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('appearance.title')}</h2>
                    <p className="text-sm text-gray-500">{t('appearance.description')}</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t('appearance.theme')}
                </label>
                <div className="flex gap-3">
                  {(['light', 'dark', 'system'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      onClick={() => {
                        saveSettings({
                          ...settings,
                          appearance: {
                            ...settings.appearance,
                            theme,
                          },
                        });
                      }}
                      className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                        settings.appearance.theme === theme
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {t(`appearance.themes.${theme}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">{t('appearance.systemHint')}</p>
              </div>
            </div>

            {/* About */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-primary-100 flex h-10 w-10 items-center justify-center rounded-lg">
                    <Info className="text-primary-600 h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">{t('about.title')}</h2>
                    <p className="text-sm text-gray-500">{t('about.description')}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t('about.application')}</span>
                  <span className="text-sm font-medium text-gray-900">PairUX Web</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t('about.platform')}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {t('about.platformValue')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t('about.features')}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {t('about.featuresValue')}
                  </span>
                </div>
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-600">
                    {t.rich('about.downloadNote', {
                      link: (chunks) => (
                        <Link href="/download" className="text-primary-600 hover:underline">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {footer}
    </div>
  );
}
