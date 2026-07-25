import { MousePointer2, Hand, Loader2 } from 'lucide-react';
import type { ControlStateUI } from '@pairux/shared-types';

interface ControlRequestButtonProps {
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  onRequestControl: () => void;
  onReleaseControl: () => void;
  className?: string;
}

/**
 * Asks the host for control, and shows where that request stands.
 *
 * The host approves each request, so this never grants anything by itself —
 * `granted` only appears after the host says yes.
 */
export function ControlRequestButton({
  controlState,
  dataChannelReady,
  onRequestControl,
  onReleaseControl,
  className = '',
}: ControlRequestButtonProps) {
  const isDisabled = !dataChannelReady;

  if (controlState === 'granted') {
    return (
      <button
        type="button"
        onClick={onReleaseControl}
        disabled={isDisabled}
        className={`flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        title="Release control"
      >
        <MousePointer2 className="h-4 w-4" />
        <span>In Control</span>
      </button>
    );
  }

  if (controlState === 'requested') {
    return (
      <button
        type="button"
        disabled
        className={`flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground ${className}`}
        title="Waiting for the host to approve"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Requested...</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onRequestControl}
      disabled={isDisabled}
      className={`flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      title={isDisabled ? 'Connecting...' : 'Ask the host for control'}
    >
      <Hand className="h-4 w-4" />
      <span>Request Control</span>
    </button>
  );
}
