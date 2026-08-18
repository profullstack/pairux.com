/**
 * Hook for managing input injection on the host side
 * Handles enabling/disabling injection and processing incoming input events
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import type { InputEvent } from '@pairux/shared-types';
import type { InputInjectionDiagnostics } from '../../preload/api';

// Network-originated input must not be able to grow the host's IPC queue
// without bound. Continuous gestures are sampled once per frame, while button
// and keyboard events are rate-limited below.
const INPUT_FRAME_MS = 16;
const MAX_DISCRETE_EVENTS_PER_SECOND = 30;
const DISCRETE_EVENT_BURST = 15;
const MAX_QUEUED_INJECTIONS = 32;

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
  const pendingMove = useRef<InputEvent | null>(null);
  const pendingScroll = useRef<Extract<InputEvent, { type: 'mouse'; action: 'scroll' }> | null>(
    null
  );
  const flushTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IPC handlers may run concurrently. Keep every OS injection in the order
  // it arrived, especially move -> down -> up. Without this queue, a button
  // down that is waiting for a pending move batch can be overtaken by its up,
  // leaving a mouse button held on the host desktop.
  const injectionQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedInjectionCount = useRef(0);
  const discreteRateLimit = useRef({ tokens: DISCRETE_EVENT_BURST, updatedAt: Date.now() });
  const pressedMouseButtons = useRef(new Set<string>());
  const pressedKeys = useRef(new Set<string>());

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
    (
      operation: () => Promise<unknown>,
      errorMessage: string,
      isRequiredRelease = false
    ): Promise<void> => {
      // A release for an accepted press gets a bounded exception: it
      // prevents stuck input while the pressed-key/button sets limit how many
      // such exceptions a sender can create.
      if (queuedInjectionCount.current >= MAX_QUEUED_INJECTIONS && !isRequiredRelease) {
        return Promise.resolve();
      }

      queuedInjectionCount.current += 1;
      const queued = injectionQueue.current.then(async () => {
        try {
          await operation();
        } catch (error) {
          console.error(errorMessage, error);
        }
      });

      // The operation catches its own error, so later input is never blocked
      // behind a rejected promise.
      injectionQueue.current = queued.finally(() => {
        queuedInjectionCount.current -= 1;
      });
      return injectionQueue.current;
    },
    []
  );

  const consumeDiscreteEventToken = useCallback((event: InputEvent): boolean => {
    const isMouseRelease =
      event.type === 'mouse' &&
      event.action === 'up' &&
      pressedMouseButtons.current.delete(event.button);
    const isKeyRelease =
      event.type === 'keyboard' && event.action === 'up' && pressedKeys.current.delete(event.code);

    // A release for an accepted press must always get through. Otherwise rate
    // limiting could leave the host with a key or button stuck down.
    if (isMouseRelease || isKeyRelease) return true;

    const now = Date.now();
    const elapsedSeconds = Math.max(0, now - discreteRateLimit.current.updatedAt) / 1000;
    discreteRateLimit.current.tokens = Math.min(
      DISCRETE_EVENT_BURST,
      discreteRateLimit.current.tokens + elapsedSeconds * MAX_DISCRETE_EVENTS_PER_SECOND
    );
    discreteRateLimit.current.updatedAt = now;

    if (discreteRateLimit.current.tokens < 1) return false;
    discreteRateLimit.current.tokens -= 1;

    if (event.type === 'mouse' && event.action === 'down') {
      pressedMouseButtons.current.add(event.button);
    } else if (event.type === 'keyboard' && event.action === 'down') {
      pressedKeys.current.add(event.code);
    }

    return true;
  }, []);

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
    const events = [pendingMove.current, pendingScroll.current].filter(
      (event): event is InputEvent => event !== null
    );
    pendingMove.current = null;
    pendingScroll.current = null;
    if (events.length === 0) return;

    await enqueueInjection(
      () => window.electronAPI.invoke('input:injectBatch', { events }),
      '[useInputInjection] Failed to inject batch:'
    );
  }, [enqueueInjection]);

  // Inject a single event (batched for performance)
  const injectEvent = useCallback(
    async (event: InputEvent) => {
      if (!isEnabledRef.current) return;

      // Intermediate mouse positions are not useful to the host. Keep only
      // the latest one and sample it once per frame.
      if (event.type === 'mouse' && event.action === 'move') {
        pendingMove.current = event;

        // Flush after a short delay to sample at most once per frame.
        flushTimeout.current ??= setTimeout(() => {
          flushTimeout.current = null;
          void flushEvents();
        }, INPUT_FRAME_MS); // ~60fps
      } else if (event.type === 'mouse' && event.action === 'scroll') {
        // Trackpads emit scrolls at a very high rate. Preserve the cumulative
        // distance while turning the whole frame into one OS injection.
        const existing = pendingScroll.current;
        pendingScroll.current =
          existing && existing.deltaMode === event.deltaMode
            ? {
                ...event,
                deltaX: existing.deltaX + event.deltaX,
                deltaY: existing.deltaY + event.deltaY,
              }
            : event;

        flushTimeout.current ??= setTimeout(() => {
          flushTimeout.current = null;
          void flushEvents();
        }, INPUT_FRAME_MS);
      } else {
        const isRequiredRelease =
          (event.type === 'mouse' &&
            event.action === 'up' &&
            pressedMouseButtons.current.has(event.button)) ||
          (event.type === 'keyboard' &&
            event.action === 'up' &&
            pressedKeys.current.has(event.code));
        if (!consumeDiscreteEventToken(event)) return;

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
          '[useInputInjection] Failed to inject:',
          isRequiredRelease
        );
        await moveFlush;
        await injection;
      }
    },
    [flushEvents, enqueueInjection, consumeDiscreteEventToken]
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
    const mouseButtons = pressedMouseButtons.current;
    const keys = pressedKeys.current;

    return () => {
      if (flushTimeout.current) {
        clearTimeout(flushTimeout.current);
      }
      pendingMove.current = null;
      pendingScroll.current = null;
      mouseButtons.clear();
      keys.clear();
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
