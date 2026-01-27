'use client';

import { useState, useEffect } from 'react';
import { Settings, Info, Wifi, Palette } from 'lucide-react';
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

const networkQualityLabel: Record<NetworkQuality, string> = {
  excellent: 'Excellent',
  good: 'Good',
  poor: 'Poor',
  bad: 'Bad',
};

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
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

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
        Session Settings
      </h3>

      <div className="mt-4 space-y-4">
        {/* Session Info */}
        <div className="rounded-lg bg-gray-800 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase">
            <Info className="h-3.5 w-3.5" />
            Session Info
          </h4>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Session Code</span>
              <span className="font-mono text-xs font-medium text-white">{session.join_code}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Status</span>
              <span className="text-xs font-medium text-white capitalize">{session.status}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Participants</span>
              <span className="text-xs font-medium text-white">
                {participantCount}
                {session.settings.maxParticipants
                  ? ` / ${String(session.settings.maxParticipants)}`
                  : ''}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Created</span>
              <span className="text-xs font-medium text-white">
                {new Date(session.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>

        {/* Connection Quality */}
        <div className="rounded-lg bg-gray-800 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-gray-400 uppercase">
            <Wifi className="h-3.5 w-3.5" />
            Connection Quality
          </h4>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Status</span>
              <span className="text-xs font-medium text-white capitalize">{connectionState}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Network</span>
              <span className={`text-xs font-medium ${networkQualityColor[networkQuality]}`}>
                {networkQualityLabel[networkQuality]}
              </span>
            </div>
            {qualityMetrics && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Frame Rate</span>
                  <span className="text-xs font-medium text-white">
                    {String(qualityMetrics.frameRate)} fps
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Packet Loss</span>
                  <span className="text-xs font-medium text-white">
                    {qualityMetrics.packetLoss.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Latency</span>
                  <span className="text-xs font-medium text-white">
                    {qualityMetrics.roundTripTime.toFixed(0)} ms
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
            Appearance
          </h4>
          <div className="mt-2 flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  handleThemeChange(t);
                }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                  theme === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
