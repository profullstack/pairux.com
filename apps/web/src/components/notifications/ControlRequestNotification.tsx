'use client';

import { memo } from 'react';
import { MousePointer2, X, Check } from 'lucide-react';
import type { ControlRequestNotification as ControlRequestNotificationType } from '@/hooks/useNotifications';

interface ControlRequestNotificationProps {
  notification: ControlRequestNotificationType;
  onApprove: (viewerId: string) => void;
  onDeny: (notificationId: string) => void;
}

export const ControlRequestNotification = memo(function ControlRequestNotification({
  notification,
  onApprove,
  onDeny,
}: ControlRequestNotificationProps) {
  return (
    <div
      className="animate-in slide-in-from-right-full flex w-80 items-start gap-3 rounded-lg border border-yellow-500/30 bg-gray-900 p-4 shadow-lg"
      role="alert"
      aria-live="polite"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
        <MousePointer2 className="h-5 w-5 text-yellow-500" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Control Request</p>
        <p className="mt-0.5 truncate text-sm text-gray-400">
          <span className="font-medium text-gray-200">{notification.displayName}</span> wants to
          control your screen
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              onApprove(notification.viewerId);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            <Check className="h-4 w-4" />
            Approve
          </button>
          <button
            onClick={() => {
              onDeny(notification.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            <X className="h-4 w-4" />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
});
