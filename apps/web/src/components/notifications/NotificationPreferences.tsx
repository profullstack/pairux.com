'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface NotificationPrefs {
  pushEnabled: boolean;
  controlRequest: boolean;
  chatMessage: boolean;
  participantJoined: boolean;
  participantLeft: boolean;
  hostDisconnected: boolean;
  creatorLive: boolean;
  directMessage: boolean;
  meetingReminder1Day: boolean;
  meetingReminder1Hour: boolean;
  meetingReminder15Min: boolean;
  meetingReminder1Min: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  pushEnabled: true,
  controlRequest: true,
  chatMessage: true,
  participantJoined: true,
  participantLeft: true,
  hostDisconnected: true,
  creatorLive: true,
  directMessage: true,
  meetingReminder1Day: true,
  meetingReminder1Hour: true,
  meetingReminder15Min: true,
  meetingReminder1Min: true,
};

const PREF_LABELS: Record<
  Exclude<keyof NotificationPrefs, 'pushEnabled' | ReminderKey>,
  string
> = {
  controlRequest: 'Control requests',
  chatMessage: 'Chat messages',
  participantJoined: 'Participant joined',
  participantLeft: 'Participant left',
  hostDisconnected: 'Host disconnected',
  creatorLive: 'A creator you follow goes live',
  directMessage: 'Someone sends you a direct message',
};

type ReminderKey =
  | 'meetingReminder1Day'
  | 'meetingReminder1Hour'
  | 'meetingReminder15Min'
  | 'meetingReminder1Min';

/**
 * Meeting reminders, kept out of the list above on purpose.
 *
 * The toggles above only render once the browser is subscribed to push, which
 * is right for them — they describe push notifications and nothing else. These
 * four also govern the *emailed* reminder, so hiding them behind a push
 * subscription would leave anyone who has not enabled push, or cannot (an
 * iPhone that has not installed the app, a locked-down browser), receiving
 * emails they have no way to turn off.
 */
const REMINDER_LABELS: Record<ReminderKey, string> = {
  meetingReminder1Day: '1 day before',
  meetingReminder1Hour: '1 hour before',
  meetingReminder15Min: '15 minutes before',
  meetingReminder1Min: '1 minute before',
};

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        enabled ? 'bg-primary-600' : 'bg-gray-300'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function NotificationPreferences() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe } =
    usePushNotifications();

  const [preferences, setPreferences] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  // Load preferences from server
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/settings');
        const result = (await response.json()) as {
          data?: { settings?: Record<string, unknown> };
        };
        const settings = result.data?.settings ?? {};
        if (settings.notifications) {
          setPreferences((prev) => ({
            ...prev,
            ...(settings.notifications as Partial<NotificationPrefs>),
          }));
        }
      } catch {
        // Ignore errors (e.g., when not authenticated)
      }
    };
    void loadPreferences();
  }, []);

  const savePreference = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      const newPrefs = { ...preferences, [key]: value };
      setPreferences(newPrefs);
      setSaving(true);

      try {
        const getRes = await fetch('/api/settings');
        const getData = (await getRes.json()) as {
          data?: { settings?: Record<string, unknown> };
        };
        const currentSettings = getData.data?.settings ?? {};

        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: { ...currentSettings, notifications: newPrefs },
          }),
        });
      } catch {
        // Revert on error
        setPreferences(preferences);
      } finally {
        setSaving(false);
      }
    },
    [preferences]
  );

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <p className="text-sm text-yellow-800">
          Push notifications are not supported in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Subscribe / Unsubscribe */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSubscribed ? (
            <Bell className="h-5 w-5 text-green-600" />
          ) : (
            <BellOff className="h-5 w-5 text-gray-400" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-700">Push Notifications</p>
            <p className="text-xs text-gray-500">
              {isSubscribed
                ? 'Notifications are enabled for this device'
                : permission === 'denied'
                  ? 'Notifications are blocked in browser settings'
                  : 'Enable to receive notifications when the app is in the background'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void (isSubscribed ? unsubscribe() : subscribe());
          }}
          disabled={isLoading || permission === 'denied'}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            isSubscribed
              ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              : 'bg-primary-600 hover:bg-primary-700 text-white'
          } ${isLoading || permission === 'denied' ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isSubscribed ? (
            'Disable'
          ) : (
            'Enable'
          )}
        </button>
      </div>

      {/* Event toggles (only shown when subscribed) */}
      {isSubscribed && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Notify me about
          </p>
          {(Object.entries(PREF_LABELS) as [keyof typeof PREF_LABELS, string][]).map(
            ([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{label}</span>
                <Toggle
                  enabled={preferences[key]}
                  onChange={() => {
                    void savePreference(key, !preferences[key]);
                  }}
                  disabled={saving}
                />
              </div>
            )
          )}
        </div>
      )}

      {/*
       * Always rendered, unlike the block above. These govern the emailed
       * reminder as well as the pushed one, so somebody who has never enabled
       * push still needs a way to turn them off.
       */}
      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Meeting reminders
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Sent by email, and as a notification when push is on.
          </p>
        </div>
        {(Object.entries(REMINDER_LABELS) as [ReminderKey, string][]).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-sm text-gray-700">{label}</span>
            <Toggle
              enabled={preferences[key]}
              onChange={() => {
                void savePreference(key, !preferences[key]);
              }}
              disabled={saving}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
