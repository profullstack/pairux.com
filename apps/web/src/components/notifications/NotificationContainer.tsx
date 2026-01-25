'use client';

import { memo } from 'react';
import { UserPlus, UserMinus } from 'lucide-react';
import { ControlRequestNotification } from './ControlRequestNotification';
import type { Notification } from '@/hooks/useNotifications';

interface NotificationContainerProps {
  notifications: Notification[];
  onApproveControl: (viewerId: string) => void;
  onDenyControl: (notificationId: string) => void;
  onDismiss: (notificationId: string) => void;
}

export const NotificationContainer = memo(function NotificationContainer({
  notifications,
  onApproveControl,
  onDenyControl,
  onDismiss,
}: NotificationContainerProps) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {notifications.map((notification) => {
        if (notification.type === 'control-request') {
          return (
            <ControlRequestNotification
              key={notification.id}
              notification={notification}
              onApprove={onApproveControl}
              onDeny={onDenyControl}
            />
          );
        }

        if (notification.type === 'participant-joined') {
          return (
            <div
              key={notification.id}
              className="animate-in slide-in-from-right-full flex w-80 items-center gap-3 rounded-lg border border-green-500/30 bg-gray-900 p-3 shadow-lg"
              role="alert"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-500/20">
                <UserPlus className="h-4 w-4 text-green-500" />
              </div>
              <p className="min-w-0 flex-1 truncate text-sm text-gray-300">
                <span className="font-medium text-white">{notification.displayName}</span> joined
              </p>
              <button
                onClick={() => {
                  onDismiss(notification.id);
                }}
                className="text-gray-500 hover:text-gray-300"
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          );
        }

        // participant-left notification
        return (
          <div
            key={notification.id}
            className="animate-in slide-in-from-right-full flex w-80 items-center gap-3 rounded-lg border border-gray-500/30 bg-gray-900 p-3 shadow-lg"
            role="alert"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-500/20">
              <UserMinus className="h-4 w-4 text-gray-500" />
            </div>
            <p className="min-w-0 flex-1 truncate text-sm text-gray-300">
              <span className="font-medium text-white">{notification.displayName}</span> left
            </p>
            <button
              onClick={() => {
                onDismiss(notification.id);
              }}
              className="text-gray-500 hover:text-gray-300"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
});
