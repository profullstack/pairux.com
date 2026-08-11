/**
 * Hook for managing input injection on the host side
 * Handles enabling/disabling injection and processing incoming input events
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import type { InputEvent } from '@pairux/shared-types';
import type { InputInjectionDiagnostics } from '../../preload/api';

interface UseInputInjectionOptions {
  /**
   * Optional declarative enablement. Omit it when the host needs to await
   * platform authorization before sending a control grant.
   */
  enabled?: boolean;
  /** Callback when emergency stop is triggered */
  onEmergencyStop?: () => void;
}

interface UseInputInjectionReturn {
  /** Whether injection is currently enabled */
  isEnabled: boolean;
  /** Whether the system is initialized */
  isInitialized: boolean;
  /** Backend diagnostics from the main process */
  diagnostics: InputInjectionDiagnostics | null;
  /** Inject a single input event */
  injectEvent: (event: InputEvent) => Promise<void>;
  /** Inject multiple events in batch */
  injectBatch: (events: InputEvent[]) => Promise<void>;
  /** Manually trigger emergency stop */
  emergencyStop: () => Promise<void>;
  /**
   * Prepare the host backend before a guest receives a control grant.
   *
   * On KDE/Wayland this waits for the compositor-owned portal approval.  A
   * guest is never told they control the host until this resolves true.
   */
  activate: () => Promise<boolean>;
  /** Release input and invalidate any compositor authorization. */
  deactivate: () => Promise<void>;
}

/**
 * Hook for managing input injection on the desktop host
 */
export function useInputInjection({
  enabled,
  onEmergencyStop,
}: UseInputInjectionOptions): UseInputInjectionReturn {
  const [isEnabled, setIsEnabled] = useState(false);
  const isEnabledRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [diagnostics, setDiagnostics] = useState<InputInjectionDiagnostics | null>(null);
  const pendingEvents = useRef<InputEvent[]>([]);
  const flushTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IPC handlers may run concurrently. Keep every OS injection in the order
  // it arrived, especially move -> down -> up. Without this queue, a button
  // down that is waiting for a pending move batch can be overtaken by its up,
  // leaving a mouse button held on the host desktop.
  const injectionQueue = useRef<Promise<void>>(Promise.resolve());

  const activate = useCallback(async (): Promise<boolean> => {
    try {
      // A host can approve a request while this hook's mount effect is still
      // initializing. The main process initializer is idempotent, so make the
      // authorization path self-sufficient instead of dropping that grant.
      if (!isInitialized) await window.electronAPI.invoke('input:init', undefined);
      const result = await window.electronAPI.invoke('input:enable', undefined);
      setIsInitialized(true);
      isEnabledRef.current = result.enabled;
      setIsEnabled(result.enabled);
      setDiagnostics(result);
      return result.enabled;
    } catch (error) {
      console.error('[useInputInjection] Failed to activate:', error);
      return false;
    }
  }, [isInitialized]);

  const deactivate = useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.invoke('input:disable', undefined);
      const status = await window.electronAPI.invoke('input:status', undefined);
      isEnabledRef.current = false;
      setIsEnabled(false);
      setDiagnostics(status);
    } catch (error) {
      console.error('[useInputInjection] Failed to deactivate:', error);
    }
  }, []);

  const enqueueInjection = useCallback(
    (operation: () => Promise<unknown>, errorMessage: string): Promise<void> => {
      const queued = injectionQueue.current.then(async () => {
        try {
          await operation();
        } catch (error) {
          console.error(errorMessage, error);
        }
      });

      // The operation catches its own error, so later input is never blocked
      // behind a rejected promise.
      injectionQueue.current = queued;
      return queued;
    },
    []
  );

  // Initialize input injection system on mount
  useEffect(() => {
    const init = async () => {
      try {
        await window.electronAPI.invoke('input:init', undefined);
        const status = await window.electronAPI.invoke('input:status', undefined);
        setDiagnostics(status);
        setIsEnabled(status.enabled);
        setIsInitialized(true);
        console.log('[useInputInjection] Initialized');
      } catch (error) {
        console.error('[useInputInjection] Failed to initialize:', error);
      }
    };

    void init();
  }, []);

  // Deliberately does not tell the backend a screen size.
  //
  // Remote coordinates are normalized 0-1, so the only thing needed to place
  // them is the host's own screen geometry — which each backend already reads
  // from its own OS API in that API's units (nut-js from screen.width(), the
  // Wayland backend from the compositor). Feeding it anything else mixes units.
  //
  // This used to pass the capture track's dimensions, which are neither: the
  // track reports encoded pixels, so a Retina Mac (logical 1440x900, stream
  // 2880x1800) mapped the centre of the screen to its bottom-right corner and
  // everything past halfway fell off the display entirely.

  // Enable/disable injection based on prop
  useEffect(() => {
    if (!isInitialized || enabled === undefined) return;

    const toggle = async () => {
      try {
        if (enabled) {
          const activated = await activate();
          if (activated) {
            console.log('[useInputInjection] Enabled');
          } else {
            console.warn('[useInputInjection] Enable requested, but backend is unavailable');
          }
        } else {
          await deactivate();
          console.log('[useInputInjection] Disabled');
        }
      } catch (error) {
        console.error('[useInputInjection] Failed to toggle:', error);
      }
    };

    void toggle();
  }, [isInitialized, enabled, activate, deactivate]);

  // Listen for emergency stop from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.on('input:emergency-stop', () => {
      console.log('[useInputInjection] Emergency stop received');
      setIsEnabled(false);
      isEnabledRef.current = false;
      setDiagnostics((prev) => (prev ? { ...prev, enabled: false } : prev));
      onEmergencyStop?.();
    });

    return unsubscribe;
  }, [onEmergencyStop]);

  // Flush pending events in batch
  const flushEvents = useCallback(async () => {
    if (pendingEvents.current.length === 0) return;

    const events = [...pendingEvents.current];
    pendingEvents.current = [];

    await enqueueInjection(
      () => window.electronAPI.invoke('input:injectBatch', { events }),
      '[useInputInjection] Failed to inject batch:'
    );
  }, [enqueueInjection]);

  // Inject a single event (batched for performance)
  const injectEvent = useCallback(
    async (event: InputEvent) => {
      if (!isEnabledRef.current) return;

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

        // Enqueue both operations synchronously. Awaiting the move flush here
        // before reserving the button event's place lets a subsequent mouseup
        // jump ahead of its mousedown.
        const moveFlush = flushEvents();
        const injection = enqueueInjection(
          () => window.electronAPI.invoke('input:inject', { event }),
          '[useInputInjection] Failed to inject:'
        );
        await moveFlush;
        await injection;
      }
    },
    [flushEvents, enqueueInjection]
  );

  // Inject multiple events in batch
  const injectBatch = useCallback(
    async (events: InputEvent[]) => {
      if (!isEnabledRef.current || events.length === 0) return;

      await enqueueInjection(
        () => window.electronAPI.invoke('input:injectBatch', { events }),
        '[useInputInjection] Failed to inject batch:'
      );
    },
    [enqueueInjection]
  );

  // Emergency stop
  const emergencyStop = useCallback(async () => {
    try {
      await window.electronAPI.invoke('input:emergencyStop', undefined);
      isEnabledRef.current = false;
      setIsEnabled(false);
      setDiagnostics((prev) => (prev ? { ...prev, enabled: false } : prev));
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
        isEnabledRef.current = false;
        window.electronAPI.invoke('input:disable', undefined).catch(console.error);
      }
    };
  }, [isEnabled]);

  return {
    isEnabled,
    isInitialized,
    diagnostics,
    injectEvent,
    injectBatch,
    emergencyStop,
    activate,
    deactivate,
  };
}
