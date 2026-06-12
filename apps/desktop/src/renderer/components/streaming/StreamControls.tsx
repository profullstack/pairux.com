import { useState } from 'react';
import { Radio, Square, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RTMPDestinationInfo, RTMPStreamState } from '../../../preload/api';
import { formatDuration } from '@/hooks/useRTMPStreaming';

interface StreamControlsProps {
  stream: MediaStream;
  destinations: RTMPDestinationInfo[];
  streamStatuses: Map<string, RTMPStreamState>;
  isAnyStreaming: boolean;
  /** Master "Live stream to RTMP server(s)" toggle from Settings. */
  liveStreamEnabled: boolean;
  onStartStream: (
    destinationId: string,
    stream: MediaStream
  ) => Promise<{ success: boolean; error?: string }>;
  onStopStream: (destinationId: string) => Promise<{ success: boolean; error?: string }>;
  onStartAll: (
    stream: MediaStream
  ) => Promise<{ success: boolean; started: number; errors: string[] }>;
  onStopAll: () => Promise<{ success: boolean; stopped: number }>;
}

const STATUS_COLORS: Record<string, string> = {
  connecting: 'text-yellow-500',
  live: 'text-green-500',
  reconnecting: 'text-orange-500',
  error: 'text-red-500',
  stopped: 'text-muted-foreground',
  idle: 'text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  error: 'Error',
  stopped: 'Stopped',
  idle: 'Idle',
};

export function StreamControls({
  stream,
  destinations,
  streamStatuses,
  isAnyStreaming,
  liveStreamEnabled,
  onStartStream: _onStartStream,
  onStopStream,
  onStartAll,
  onStopAll,
}: StreamControlsProps) {
  const [startError, setStartError] = useState<string | null>(null);
  const enabledDestinations = destinations.filter((d) => d.enabled);

  if (enabledDestinations.length === 0) return null;

  // When live streaming is toggled off, hide "Go Live" entirely so a call can't
  // be streamed by accident. Active streams still render their stop controls so
  // anything already live can always be stopped.
  if (!isAnyStreaming && !liveStreamEnabled) return null;

  const handleStartAll = async (): Promise<void> => {
    setStartError(null);
    const result = await onStartAll(stream);
    // Surface failures instead of silently doing nothing — the #1 reason
    // "Go Live" appears to do nothing (bad key, ffmpeg missing, ingest down).
    if (!result.success || result.started === 0) {
      setStartError(result.errors[0] ?? 'Could not start streaming');
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1">
      {!isAnyStreaming ? (
        <>
          <Button
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => void handleStartAll()}
            title="Start streaming to all enabled destinations"
          >
            <Radio className="!size-3" />
            Go Live
            {enabledDestinations.length > 1 && ` (${String(enabledDestinations.length)})`}
          </Button>
          {startError && (
            <span
              className="flex items-center gap-1 px-1 text-xs text-red-500"
              title={startError}
            >
              <AlertCircle className="!size-3" />
              <span className="max-w-[200px] truncate">{startError}</span>
            </span>
          )}
        </>
      ) : (
        <>
          {/* Per-destination status */}
          {enabledDestinations.map((dest) => {
            const status = streamStatuses.get(dest.id);
            const statusKey = status?.status ?? 'idle';

            return (
              <div
                key={dest.id}
                className="flex items-center gap-1.5 px-2 text-sm"
                title={`${dest.name}: ${STATUS_LABELS[statusKey] ?? statusKey}`}
              >
                {statusKey === 'live' ? (
                  <Radio className="h-3 w-3 animate-pulse text-green-500" />
                ) : statusKey === 'error' ? (
                  <AlertCircle className="h-3 w-3 text-red-500" />
                ) : (
                  <Radio className={`h-3 w-3 ${STATUS_COLORS[statusKey] ?? ''}`} />
                )}
                <span className="max-w-[80px] truncate text-xs">{dest.name}</span>
                {status && statusKey === 'live' && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDuration(status.duration)}
                  </span>
                )}
                {status && statusKey === 'live' && status.bitrate > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {(status.bitrate / 1000).toFixed(1)}M
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => void onStopStream(dest.id)}
                  title={`Stop ${dest.name}`}
                >
                  <Square className="!size-2.5" />
                </Button>
              </div>
            );
          })}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onStopAll()}
            title="Stop all streams"
          >
            <Square className="!size-3" />
            Stop All
          </Button>
        </>
      )}
    </div>
  );
}
