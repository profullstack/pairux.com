'use client';

import { UserX, Clock } from 'lucide-react';

interface HostPresenceIndicatorProps {
  sessionStatus: string;
  currentHostId: string | null;
}

/**
 * Overlay shown to viewers when the host is not present.
 * Returns null when the host is online (no overlay needed).
 */
export function HostPresenceIndicator({
  sessionStatus,
  currentHostId,
}: HostPresenceIndicatorProps) {
  // Host is present — no overlay
  if (currentHostId) {
    return null;
  }

  const isNew = sessionStatus === 'created';

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/80">
      <div className="flex flex-col items-center gap-4 text-center">
        {isNew ? (
          <Clock className="h-12 w-12 text-gray-400" />
        ) : (
          <UserX className="h-12 w-12 text-gray-400" />
        )}
        <div>
          <p className="text-lg font-medium text-white">
            {isNew ? "Host hasn't joined yet" : 'Host has left'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Chat is still available. You&apos;ll be notified when the host returns.
          </p>
        </div>
      </div>
    </div>
  );
}
