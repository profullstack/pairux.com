/**
 * Hook for managing input injection on the host side
 * Handles enabling/disabling injection and processing incoming input events
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import type { InputEvent } from '@pairux/shared-types';

interface UseInputInjectionOptions {
  /** Whether injection should be active */
  enabled: boolean;
  /** Screen dimensions for coordinate mapping */
  screenSize?: { width: number; height: number };
  /** Callback when emergency stop is triggered */
  onEmergencyStop?: () => void;
}

interface UseInputInjectionReturn {
  /** Whether injection is currently enabled */
  isEnabled: boolean;
  /** Whether the system is initialized */
  isInitialized: boolean;
  /** Inject a single input event */
  injectEvent: (event: InputEvent) => Promise<void>;
  /** Inject multiple events in batch */
  injectBatch: (events: InputEvent[]) => Promise<void>;
  /** Manually trigger emergency stop */
  emergencyStop: () => Promise<void>;
}

/**
 * Hook for managing input injection on the desktop host
 */
export function useInputInjection({
  enabled,
  screenSize,
  onEmergencyStop,
}: UseInputInjectionOptions): UseInputInjectionReturn {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const pendingEvents = useRef<InputEvent[]>([]);
  const flushTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize input injection system on mount
  useEffect(() => {
    const init = async () => {
      try {
        await window.electronAPI.invoke('input:init', undefined);
        setIsInitialized(true);
        console.log('[useInputInjection] Initialized');
      } catch (error) {
        console.error('[useInputInjection] Failed to initialize:', error);
      }
    };

    void init();
  }, []);

  // Update screen size when it changes
  useEffect(() => {
    if (!isInitialized || !screenSize) return;

    const updateSize = async () => {
      try {
        await window.electronAPI.invoke('input:updateScreenSize', screenSize);
      } catch (error) {
        console.error('[useInputInjection] Failed to update screen size:', error);
      }
    };

    void updateSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, screenSize?.width, screenSize?.height]);

  // Enable/disable injection based on prop
  useEffect(() => {
    if (!isInitialized) return;

    const toggle = async () => {
      try {
        if (enabled) {
          const result = await window.electronAPI.invoke('input:enable', undefined);
          setIsEnabled(result.enabled);
          console.log('[useInputInjection] Enabled');
        } else {
          const result = await window.electronAPI.invoke('input:disable', undefined);
          setIsEnabled(result.enabled);
          console.log('[useInputInjection] Disabled');
        }
      } catch (error) {
        console.error('[useInputInjection] Failed to toggle:', error);
      }
    };

    void toggle();
  }, [isInitialized, enabled]);

  // Listen for emergency stop from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.on('input:emergency-stop', () => {
      console.log('[useInputInjection] Emergency stop received');
      setIsEnabled(false);
      onEmergencyStop?.();
    });

    return unsubscribe;
  }, [onEmergencyStop]);

  // Flush pending events in batch
  const flushEvents = useCallback(async () => {
    if (pendingEvents.current.length === 0) return;

    const events = [...pendingEvents.current];
    pendingEvents.current = [];

    try {
      await window.electronAPI.invoke('input:injectBatch', { events });
    } catch (error) {
      console.error('[useInputInjection] Failed to inject batch:', error);
    }
  }, []);

  // Inject a single event (batched for performance)
  const injectEvent = useCallback(
    async (event: InputEvent) => {
      if (!isEnabled) return;

      // For mouse moves, batch them up
      if (event.type === 'mouse' && event.action === 'move') {
        pendingEvents.current.push(event);

        // Flush after a short delay to batch moves
        flushTimeout.current ??= setTimeout(() => {
          flushTimeout.current = null;
          void flushEvents();
        }, 16); // ~60fps
      } else {
        // For clicks and keyboard, inject immediately
        // But first flush any pending moves
        if (flushTimeout.current) {
          clearTimeout(flushTimeout.current);
          flushTimeout.current = null;
        }
        await flushEvents();

        try {
          await window.electronAPI.invoke('input:inject', { event });
        } catch (error) {
          console.error('[useInputInjection] Failed to inject:', error);
        }
      }
    },
    [isEnabled, flushEvents]
  );

  // Inject multiple events in batch
  const injectBatch = useCallback(
    async (events: InputEvent[]) => {
      if (!isEnabled || events.length === 0) return;

      try {
        await window.electronAPI.invoke('input:injectBatch', { events });
      } catch (error) {
        console.error('[useInputInjection] Failed to inject batch:', error);
      }
    },
    [isEnabled]
  );

  // Emergency stop
  const emergencyStop = useCallback(async () => {
    try {
      await window.electronAPI.invoke('input:emergencyStop', undefined);
      setIsEnabled(false);
      onEmergencyStop?.();
    } catch (error) {
      console.error('[useInputInjection] Failed to emergency stop:', error);
    }
  }, [onEmergencyStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimeout.current) {
        clearTimeout(flushTimeout.current);
      }
      // Disable injection when component unmounts
      if (isEnabled) {
        window.electronAPI.invoke('input:disable', undefined).catch(console.error);
      }
    };
  }, [isEnabled]);

  return {
    isEnabled,
    isInitialized,
    injectEvent,
    injectBatch,
    emergencyStop,
  };
}
