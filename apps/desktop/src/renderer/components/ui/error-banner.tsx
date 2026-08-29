import { AlertCircle, RefreshCw, X } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ErrorBannerProps {
  /** The error text to show. Rendered verbatim, so it may be a raw fetch error. */
  message: string;
  /** Retry affordance. Omit when there is nothing sensible to re-run. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Dismiss affordance. Omit only when the banner must stay until resolved. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * A destructive banner for an error the user can act on. Network failures are often
 * transient — a dropped connection, a connect timeout — so the banner always leaves a
 * way out: retry the call, or dismiss the message and carry on.
 */
export function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'Try again',
  onDismiss,
  className,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive',
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-destructive/20"
        >
          <RefreshCw className="h-3 w-3" />
          {retryLabel}
        </button>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          title="Dismiss"
          className="flex-shrink-0 rounded p-1 hover:bg-destructive/20"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
