import { useState } from 'react';
import { Plus, Trash2, Edit, Eye, EyeOff, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RTMPDestinationInfo, StreamPlatform, EncoderSettings } from '../../../preload/api';
import { DEFAULT_ENCODER_SETTINGS, PLATFORM_DEFAULTS } from '@/hooks/useRTMPStreaming';

interface StreamDestinationsProps {
  destinations: RTMPDestinationInfo[];
  onAdd: (
    dest: Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>,
    streamKey: string
  ) => Promise<void>;
  onUpdate: (
    id: string,
    updates: Partial<Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>>,
    newKey?: string
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  facebook: 'Facebook',
  custom: 'Custom RTMP',
};

export function StreamDestinations({
  destinations,
  onAdd,
  onUpdate,
  onRemove,
}: StreamDestinationsProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // Form state
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<StreamPlatform>('youtube');
  const [rtmpUrl, setRtmpUrl] = useState(PLATFORM_DEFAULTS.youtube.rtmpUrl);
  const [streamKey, setStreamKey] = useState('');
  const [encoderSettings, setEncoderSettings] = useState<EncoderSettings>(DEFAULT_ENCODER_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const resetForm = () => {
    setName('');
    setPlatform('youtube');
    setRtmpUrl(PLATFORM_DEFAULTS.youtube.rtmpUrl);
    setStreamKey('');
    setEncoderSettings(DEFAULT_ENCODER_SETTINGS);
    setShowAdvanced(false);
    setShowAddForm(false);
    setEditingId(null);
  };

  const handlePlatformChange = (p: StreamPlatform) => {
    setPlatform(p);
    const preset = PLATFORM_DEFAULTS[p];
    setRtmpUrl(preset.rtmpUrl);
    setName(preset.name);
    setEncoderSettings({
      ...DEFAULT_ENCODER_SETTINGS,
      ...preset.encoderSettings,
    });
  };

  const handleSubmit = async () => {
    if (!name.trim() || !streamKey.trim()) return;
    if (platform === 'custom' && !rtmpUrl.trim()) return;

    if (editingId) {
      await onUpdate(editingId, { name, platform, rtmpUrl, encoderSettings }, streamKey);
    } else {
      await onAdd({ name, platform, rtmpUrl, enabled: true, encoderSettings }, streamKey);
    }
    resetForm();
  };

  const handleEdit = (dest: RTMPDestinationInfo) => {
    setEditingId(dest.id);
    setName(dest.name);
    setPlatform(dest.platform);
    setRtmpUrl(dest.rtmpUrl);
    setEncoderSettings(dest.encoderSettings);
    setStreamKey('');
    setShowAddForm(true);
  };

  const toggleKey = (id: string) => {
    setShowKey((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-4">
      {/* Destination list */}
      {destinations.map((dest) => (
        <div key={dest.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
          <div className="flex items-center gap-3">
            <div
              className={`h-2 w-2 rounded-full ${dest.enabled ? 'bg-green-500' : 'bg-gray-400'}`}
            />
            <div>
              <p className="text-sm font-medium">{dest.name}</p>
              <p className="text-xs text-muted-foreground">
                {PLATFORM_LABELS[dest.platform]} &middot;{' '}
                {String(dest.encoderSettings.videoBitrate)} kbps &middot;{' '}
                {dest.encoderSettings.resolution} &middot; {String(dest.encoderSettings.framerate)}{' '}
                fps
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                void onUpdate(dest.id, { enabled: !dest.enabled });
              }}
              title={dest.enabled ? 'Disable' : 'Enable'}
            >
              {dest.enabled ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <X className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                handleEdit(dest);
              }}
              title="Edit"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => {
                void onRemove(dest.id);
              }}
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      {/* Add/Edit form */}
      {showAddForm ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {editingId ? 'Edit Destination' : 'Add Destination'}
            </h4>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetForm}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Platform */}
          <div>
            <label className="mb-1 block text-xs font-medium">Platform</label>
            <select
              value={platform}
              onChange={(e) => {
                handlePlatformChange(e.target.value as StreamPlatform);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="youtube">YouTube</option>
              <option value="twitch">Twitch</option>
              <option value="facebook">Facebook</option>
              <option value="custom">Custom RTMP</option>
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="My YouTube Channel"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* RTMP URL (shown for custom, read-only for presets) */}
          <div>
            <label className="mb-1 block text-xs font-medium">RTMP URL</label>
            <input
              type="text"
              value={rtmpUrl}
              onChange={(e) => {
                setRtmpUrl(e.target.value);
              }}
              readOnly={platform !== 'custom'}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm read-only:opacity-60"
            />
          </div>

          {/* Stream Key */}
          <div>
            <label className="mb-1 block text-xs font-medium">Stream Key</label>
            <div className="flex gap-1">
              <input
                type={showKey[editingId ?? 'new'] ? 'text' : 'password'}
                value={streamKey}
                onChange={(e) => {
                  setStreamKey(e.target.value);
                }}
                placeholder={editingId ? 'Leave empty to keep current' : 'Enter stream key'}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  toggleKey(editingId ?? 'new');
                }}
              >
                {showKey[editingId ?? 'new'] ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Advanced encoder settings */}
          <button
            onClick={() => {
              setShowAdvanced(!showAdvanced);
            }}
            className="text-xs text-primary hover:underline"
          >
            {showAdvanced ? 'Hide' : 'Show'} encoder settings
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Video Bitrate (kbps)</label>
                <input
                  type="number"
                  min={2500}
                  max={6000}
                  step={500}
                  value={encoderSettings.videoBitrate}
                  onChange={(e) => {
                    setEncoderSettings({
                      ...encoderSettings,
                      videoBitrate: parseInt(e.target.value, 10),
                    });
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Resolution</label>
                <select
                  value={encoderSettings.resolution}
                  onChange={(e) => {
                    setEncoderSettings({
                      ...encoderSettings,
                      resolution: e.target.value as '720p' | '1080p',
                    });
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Framerate</label>
                <select
                  value={encoderSettings.framerate}
                  onChange={(e) => {
                    setEncoderSettings({
                      ...encoderSettings,
                      framerate: parseInt(e.target.value, 10) as 30 | 60,
                    });
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Keyframe Interval (s)</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={encoderSettings.keyframeInterval}
                  onChange={(e) => {
                    setEncoderSettings({
                      ...encoderSettings,
                      keyframeInterval: parseInt(e.target.value, 10),
                    });
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Audio Bitrate (kbps)</label>
                <select
                  value={encoderSettings.audioBitrate}
                  onChange={(e) => {
                    setEncoderSettings({
                      ...encoderSettings,
                      audioBitrate: parseInt(e.target.value, 10),
                    });
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value={128}>128 kbps</option>
                  <option value={160}>160 kbps</option>
                  <option value={192}>192 kbps</option>
                  <option value={256}>256 kbps</option>
                  <option value={320}>320 kbps</option>
                </select>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={!name.trim() || (!editingId && !streamKey.trim())}
            >
              {editingId ? 'Update' : 'Add'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setShowAddForm(true);
            handlePlatformChange('youtube');
          }}
        >
          <Plus className="h-4 w-4" />
          Add Destination
        </Button>
      )}
    </div>
  );
}
