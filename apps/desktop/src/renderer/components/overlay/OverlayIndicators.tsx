import { Circle, Monitor, Share2 } from 'lucide-react';
import { formatDuration } from '@/hooks/useRecording';
import type { SessionParticipant } from '@pairux/shared-types';

export interface OverlayIndicatorsProps {
  /** Whether the session is live/sharing */
  isSharing?: boolean;
  /** Recording state */
  recording?: {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
  };
  /** Participant with control (if any) */
  controlledBy?: SessionParticipant | null;
  /** Position for indicators */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Custom class name */
  className?: string;
}

/**
 * Overlay indicators for session status
 * Shows recording, sharing, and control active states
 */
export function OverlayIndicators({
  isSharing = false,
  recording,
  controlledBy,
  position = 'top-left',
  className = '',
}: OverlayIndicatorsProps) {
  const positionClasses = {
    'top-left': 'left-4 top-4',
    'top-right': 'right-4 top-4',
    'bottom-left': 'left-4 bottom-4',
    'bottom-right': 'right-4 bottom-4',
  };

  return (
    <div
      className={`absolute ${positionClasses[position]} flex flex-col gap-2 ${className}`}
      data-testid="overlay-indicators"
    >
      {/* Live/Sharing indicator */}
      {isSharing && (
        <div
          className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5"
          data-testid="sharing-indicator"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-medium text-white">LIVE</span>
        </div>
      )}

      {/* Recording indicator */}
      {recording?.isRecording && (
        <RecordingIndicator isPaused={recording.isPaused} duration={recording.duration} />
      )}

      {/* Control Active indicator */}
      {controlledBy && <ControlActiveIndicator participant={controlledBy} />}
    </div>
  );
}

interface RecordingIndicatorProps {
  isPaused: boolean;
  duration: number;
}

/**
 * Recording indicator showing recording status and duration
 */
export function RecordingIndicator({ isPaused, duration }: RecordingIndicatorProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1.5"
      data-testid="recording-indicator"
    >
      <Circle className={`h-2 w-2 fill-white text-white ${!isPaused ? 'animate-pulse' : ''}`} />
      <span className="font-mono text-xs font-medium text-white">
        {isPaused ? 'PAUSED' : 'REC'} {formatDuration(duration)}
      </span>
    </div>
  );
}

interface ControlActiveIndicatorProps {
  participant: SessionParticipant;
}

/**
 * Control Active indicator showing who has control
 */
export function ControlActiveIndicator({ participant }: ControlActiveIndicatorProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-green-600/90 px-3 py-1.5"
      data-testid="control-active-indicator"
    >
      <Monitor className="h-3 w-3 text-white" />
      <span className="text-xs font-medium text-white">{participant.display_name} has control</span>
    </div>
  );
}

/**
 * Sharing status indicator (standalone)
 */
export function SharingIndicator({ isLive = false }: { isLive?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5"
      data-testid="sharing-indicator"
    >
      {isLive ? (
        <>
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-medium text-white">LIVE</span>
        </>
      ) : (
        <>
          <Share2 className="h-3 w-3 text-white" />
          <span className="text-xs font-medium text-white">PREVIEW</span>
        </>
      )}
    </div>
  );
}
