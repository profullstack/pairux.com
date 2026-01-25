'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface ControlRequestNotification {
  id: string;
  type: 'control-request';
  viewerId: string;
  displayName: string;
  timestamp: number;
}

export interface ParticipantJoinedNotification {
  id: string;
  type: 'participant-joined';
  participantId: string;
  displayName: string;
  timestamp: number;
}

export interface ParticipantLeftNotification {
  id: string;
  type: 'participant-left';
  participantId: string;
  displayName: string;
  timestamp: number;
}

export type Notification =
  | ControlRequestNotification
  | ParticipantJoinedNotification
  | ParticipantLeftNotification;

// Input type for adding notifications (without id and timestamp)
export type NotificationInput =
  | Omit<ControlRequestNotification, 'id' | 'timestamp'>
  | Omit<ParticipantJoinedNotification, 'id' | 'timestamp'>
  | Omit<ParticipantLeftNotification, 'id' | 'timestamp'>;

// Default auto-dismiss timeout (15 seconds for control requests)
const DEFAULT_AUTO_DISMISS_MS = 15000;

interface UseNotificationsOptions {
  autoDismissMs?: number;
  maxNotifications?: number;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  addNotification: (notification: NotificationInput) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsReturn {
  const { autoDismissMs = DEFAULT_AUTO_DISMISS_MS, maxNotifications = 5 } = options;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
    };
  }, []);

  const removeNotification = useCallback((id: string) => {
    // Clear the timer if it exists
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback(
    (notification: NotificationInput): string => {
      const id = `${notification.type}-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`;
      const fullNotification = {
        ...notification,
        id,
        timestamp: Date.now(),
      } as Notification;

      setNotifications((prev) => {
        // Limit to max notifications (remove oldest if needed)
        const updated = [...prev, fullNotification];
        if (updated.length > maxNotifications) {
          const removed = updated.shift();
          if (removed) {
            const timer = timersRef.current.get(removed.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(removed.id);
            }
          }
        }
        return updated;
      });

      // Set auto-dismiss timer (only for non-control-request notifications)
      // Control requests need explicit action
      if (notification.type !== 'control-request' && autoDismissMs > 0) {
        const timer = setTimeout(() => {
          removeNotification(id);
        }, autoDismissMs);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [autoDismissMs, maxNotifications, removeNotification]
  );

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => {
      clearTimeout(timer);
    });
    timersRef.current.clear();
    setNotifications([]);
  }, []);

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
  };
}
