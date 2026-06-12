import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Monitor,
  Video,
  Radio,
  Users,
  Info,
  FolderOpen,
  Cloud,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StreamDestinations } from '@/components/streaming';
import { LIVE_STREAM_CHANGED_EVENT } from '@/lib/liveStream';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI, isElectron } from '@/lib/ipc';
import type { RecordingQuality } from '@/hooks/useRecording';
import { useRTMPStreaming } from '@/hooks/useRTMPStreaming';
import { API_BASE_URL } from '../../shared/config';

interface AppSettings {
  recording: {
    defaultQuality: RecordingQuality;
  };
  session: {
    defaultMaxParticipants: number;
    allowGuestControlByDefault: boolean;
  };
  streaming: {
    liveStreamEnabled: boolean;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  recording: {
    defaultQuality: '1080p',
  },
  session: {
    defaultMaxParticipants: 10,
    allowGuestControlByDefault: false,
  },
  streaming: {
    // Opt-in: going live to YouTube/Twitch is off by default so a routine call
    // is never streamed by accident.
    liveStreamEnabled: false,
  },
};

export function SettingsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [recordingsPath, setRecordingsPath] = useState<string>('');
  const { destinations, addDestination, updateDestination, removeDestination } = useRTMPStreaming();
  const [platformInfo, setPlatformInfo] = useState<{
    platform: string;
    version: string;
    appVersion: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isTogglingDevTools, setIsTogglingDevTools] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('pairux-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<AppSettings>;
        setSettings((prev) => ({
          ...prev,
          ...parsed,
          recording: { ...prev.recording, ...parsed.recording },
          session: { ...prev.session, ...parsed.session },
          streaming: { ...prev.streaming, ...parsed.streaming },
        }));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Update settings locally (marks as having changes)
  const updateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('pairux-settings', JSON.stringify(newSettings));
    // Notify same-window listeners (e.g. the capture screen's Go Live control)
    // since the `storage` event only fires in other windows.
    window.dispatchEvent(new Event(LIVE_STREAM_CHANGED_EVENT));
    setHasChanges(true);
    setSaveSuccess(false);
    setSaveError(null);
  };

  // Save settings to cloud
  const handleSaveToCloud = async () => {
    if (!user) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      // Get auth token from secure storage via IPC
      const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
      if (!token) {
        setSaveError('Not authenticated. Please log in again.');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ settings }),
      });

      if (response.ok) {
        setSaveSuccess(true);
        setHasChanges(false);
        setTimeout(() => {
          setSaveSuccess(false);
        }, 3000);
      } else {
        console.error('Failed to save settings to cloud');
        setSaveError('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveError('Could not connect to server');
    } finally {
      setIsSaving(false);
    }
  };

  // Load platform info and recordings path
  useEffect(() => {
    if (isElectron()) {
      const api = getElectronAPI();
      void api.invoke('platform:info', undefined).then((info) => {
        setPlatformInfo({
          platform: info.platform,
          version: info.version,
          appVersion: info.appVersion,
        });
      });
      void api.invoke('recording:getDirectory', undefined).then((result) => {
        setRecordingsPath(result.path);
      });
    }
  }, []);

  const handleOpenRecordingsFolder = async () => {
    if (isElectron()) {
      await getElectronAPI().invoke('recording:openFolder', undefined);
    }
  };

  const handleToggleDevTools = async () => {
    if (!isElectron()) return;
    setIsTogglingDevTools(true);
    try {
      await getElectronAPI().invoke('platform:toggle-devtools', undefined);
    } catch (error) {
      console.error('Failed to toggle DevTools:', error);
    } finally {
      setIsTogglingDevTools(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => void navigate('/')}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>

        {/* Save to Cloud button */}
        {user && (
          <button
            onClick={() => void handleSaveToCloud()}
            disabled={isSaving || (!hasChanges && !saveSuccess)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              saveSuccess
                ? 'bg-green-600 text-white'
                : hasChanges
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground'
            } disabled:opacity-50`}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saveSuccess ? (
              <Check className="h-4 w-4" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            {saveSuccess ? 'Saved!' : 'Save to Cloud'}
          </button>
        )}
      </div>

      {/* Error message */}
      {saveError && (
        <div className="mb-6 flex max-w-3xl items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{saveError}</span>
          <button
            onClick={() => {
              setSaveError(null);
            }}
            className="ml-auto text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid max-w-3xl gap-6">
        {/* Account Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Account</CardTitle>
            </div>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-sm text-muted-foreground">{user?.email ?? 'Not signed in'}</p>
              </div>
            </div>
            {profile && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Display Name</p>
                  <p className="text-sm text-muted-foreground">
                    {profile.display_name ?? 'Not set'}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recording Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Recording</CardTitle>
            </div>
            <CardDescription>Default recording preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Default Quality</label>
              <select
                value={settings.recording.defaultQuality}
                onChange={(e) => {
                  updateSettings({
                    ...settings,
                    recording: {
                      ...settings.recording,
                      defaultQuality: e.target.value as RecordingQuality,
                    },
                  });
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
                <option value="4k">4K (where available)</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Higher quality uses more disk space and CPU
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <div>
                <p className="text-sm font-medium">Recordings Folder</p>
                <p className="text-xs text-muted-foreground">{recordingsPath || 'Loading...'}</p>
              </div>
              <button
                onClick={() => void handleOpenRecordingsFolder()}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/10"
              >
                <FolderOpen className="h-4 w-4" />
                Open
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Live Streaming */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Live Streaming</CardTitle>
            </div>
            <CardDescription>Configure RTMP streaming destinations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Live stream to RTMP server(s)</p>
                <p className="text-xs text-muted-foreground">
                  When on, you can “Go Live” to the enabled destinations below (YouTube, Twitch,
                  …). When off, streaming is disabled so calls aren’t broadcast by accident.
                </p>
              </div>
              <button
                aria-label="Toggle live streaming"
                aria-pressed={settings.streaming.liveStreamEnabled}
                onClick={() => {
                  updateSettings({
                    ...settings,
                    streaming: {
                      ...settings.streaming,
                      liveStreamEnabled: !settings.streaming.liveStreamEnabled,
                    },
                  });
                }}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  settings.streaming.liveStreamEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.streaming.liveStreamEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <StreamDestinations
              destinations={destinations}
              onAdd={addDestination}
              onUpdate={updateDestination}
              onRemove={removeDestination}
            />
          </CardContent>
        </Card>

        {/* Session Defaults */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Session Defaults</CardTitle>
            </div>
            <CardDescription>Default settings for new sessions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Maximum Participants</label>
              <select
                value={settings.session.defaultMaxParticipants}
                onChange={(e) => {
                  updateSettings({
                    ...settings,
                    session: {
                      ...settings.session,
                      defaultMaxParticipants: parseInt(e.target.value, 10),
                    },
                  });
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={5}>5 participants</option>
                <option value={10}>10 participants</option>
                <option value={25}>25 participants</option>
                <option value={50}>50 participants</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Allow Guest Control by Default</p>
                <p className="text-xs text-muted-foreground">
                  Guests can request control of your screen
                </p>
              </div>
              <button
                onClick={() => {
                  updateSettings({
                    ...settings,
                    session: {
                      ...settings.session,
                      allowGuestControlByDefault: !settings.session.allowGuestControlByDefault,
                    },
                  });
                }}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  settings.session.allowGuestControlByDefault ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.session.allowGuestControlByDefault ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">About</CardTitle>
            </div>
            <CardDescription>Application information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Application</span>
              <span className="text-sm font-medium">PairUX</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <span className="text-sm font-medium">
                {platformInfo?.appVersion ?? 'Loading...'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Platform</span>
              <span className="text-sm font-medium capitalize">
                {platformInfo?.platform ?? 'Loading...'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Electron Version</span>
              <span className="text-sm font-medium">{platformInfo?.version ?? 'Loading...'}</span>
            </div>
            {isElectron() && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleToggleDevTools()}
                  disabled={isTogglingDevTools}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {isTogglingDevTools ? 'Opening…' : 'Toggle Developer Tools'}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
