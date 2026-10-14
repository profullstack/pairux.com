'use client';

import { useState, useEffect } from 'react';
import { Settings, Info, Wifi, Palette } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ConnectionState, QualityMetrics, NetworkQuality } from '@pairux/shared-types';

interface SessionData {
  id: string;
  join_code: string;
  status: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  created_at: string;
  session_participants: {
    id: string;
    display_name: string;
    role: string;
    control_state: string;
    joined_at: string;
  }[];
}

export interface SessionSettingsPanelProps {
  session: SessionData;
  connectionState: ConnectionState;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  participantCount: number;
}

const SETTINGS_KEY = 'pairux-web-settings';

const networkQualityColor: Record<NetworkQuality, string> = {
  excellent: 'text-green-400',
  good: 'text-green-400',
  poor: 'text-yellow-400',
  bad: 'text-red-400',
};

export function SessionSettingsPanel({
  session,
  connectionState,
  qualityMetrics,
  networkQuality,
  participantCount,
}: SessionSettingsPanelProps) {
  const t = useTranslations('session.settingsPanel');
  const locale = useLocale();
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const statusKey = `sessionStatus.${session.status}` as 'sessionStatus.active';
  const sessionStatusLabel = t.has(statusKey) ? t(statusKey) : session.status;

  useEffect(() => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as { appearance?: { theme?: string } };
        if (parsed.appearance?.theme) {
          setTheme(parsed.appearance.theme as 'light' | 'dark' | 'system');
        }
      } catch {
        // ignore
      }
    }
  }, []);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    let settings: Record<string, unknown> = {};
    if (savedSettings) {
      try {
        settings = JSON.parse(savedSettings) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    settings.appearance = { theme: newTheme };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  };

  return (
    <div className="flex h-full flex-col p-4" data-testid="session-settings-panel">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Settings className="h-4 w-4" />
        {t('title')}
      </h3>

      <div className="mt-4 space-y-4">
        {/* Session Info */}
        <div className="rounded-lg bg-gray-800 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase">
            <Info className="h-3.5 w-3.5" />
            {t('sessionInfo')}
          </h4>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('sessionCode')}</span>
              <span className="font-mono text-xs font-medium text-white">{session.join_code}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('status')}</span>
              <span className="text-xs font-medium text-white capitalize">
                {sessionStatusLabel}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('participants')}</span>
              <span className="text-xs font-medium text-white">
                {participantCount}
                {session.settings.maxParticipants
                  ? ` / ${String(session.settings.maxParticipants)}`
                  : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('created')}</span>
              <span className="text-xs font-medium text-white">
                {new Date(session.created_at).toLocaleTimeString(locale)}
              </span>
            </div>
          </div>
        </div>

        {/* Connection Quality */}
        <div className="rounded-lg bg-gray-800 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase">
            <Wifi className="h-3.5 w-3.5" />
            {t('connectionQuality')}
          </h4>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('status')}</span>
              <span className="text-xs font-medium text-white capitalize">
                {t(`connectionState.${connectionState}`)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('network')}</span>
              <span className={`text-xs font-medium ${networkQualityColor[networkQuality]}`}>
                {t(`networkQuality.${networkQuality}`)}
              </span>
            </div>
            {qualityMetrics && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{t('frameRate')}</span>
                  <span className="text-xs font-medium text-white">
                    {t('fps', { value: qualityMetrics.frameRate })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{t('packetLoss')}</span>
                  <span className="text-xs font-medium text-white">
                    {qualityMetrics.packetLoss.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{t('latency')}</span>
                  <span className="text-xs font-medium text-white">
                    {t('ms', { value: qualityMetrics.roundTripTime.toFixed(0) })}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="rounded-lg bg-gray-800 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase">
            <Palette className="h-3.5 w-3.5" />
            {t('appearance')}
          </h4>
          <div className="mt-2 flex gap-2">
            {(['light', 'dark', 'system'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  handleThemeChange(option);
                }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                  theme === option
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {t(`theme.${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
