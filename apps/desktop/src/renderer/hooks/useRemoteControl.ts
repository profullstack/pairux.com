import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import type {
  InputEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardEvent as KeyboardInputEvent,
  MouseButton,
  ControlStateUI,
} from '@pairux/shared-types';
import {
  isLocalControlTarget,
  modifiersFromDomEvent,
  normalizedPointOnVideo,
  shouldIgnoreFollowUpMouse,
} from '@pairux/shared-types';
import { getAccelPlatform } from '@/lib/viewerPlatform';

interface UseRemoteControlOptions {
  enabled: boolean;
  controlState: ControlStateUI;
  containerRef: React.RefObject<HTMLElement | null>;
  onInputEvent: (event: InputEvent) => void;
  /**
   * Under pointer lock there is no cursor position to read from the event —
   * the browser reports movement deltas instead. When set, every click and
   * move reads coordinates from this ref rather than from event.clientX/Y.
   * The ref is updated by the pointer-lock movement handler externally.
   */
  pointerLockPosition?: React.RefObject<{ x: number; y: number } | null> | undefined;
}

interface UseRemoteControlReturn {
  isCapturing: boolean;
  startCapture: () => void;
  stopCapture: () => void;
}

// Convert DOM mouse button to our MouseButton type
function toMouseButton(button: number): MouseButton {
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return 'left';
  }
}

export function useRemoteControl({
  enabled,
  controlState,
  containerRef,
  onInputEvent,
  pointerLockPosition,
}: UseRemoteControlOptions): UseRemoteControlReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  // Read once: it cannot change while the app runs. Kept out of module scope so
  // importing this hook has no side effects.
  const viewerPlatform = useMemo(() => getAccelPlatform(), []);
  // Buttons/keys this viewer has sent a "down" for. Every one of them must get
  // an "up", or the host is left mid-drag with a stuck button.
  const heldButtonsRef = useRef<Set<MouseButton>>(new Set());
  const heldKeysRef = useRef<Set<string>>(new Set());
  // Pointer events fire before mouse events in Chromium. Storing the last
  // pointer event's timestamp lets the mouse handler skip a double-fire.
  const lastPointerEventRef = useRef(0);

  // Check if we can send input (enabled, granted control, and capturing)
  const canSendInput = enabled && controlState === 'granted' && isCapturing;

  // Get relative coordinates (0-1) from a mouse event
  const getRelativeCoords = useCallback(
    (event?: MouseEvent): { x: number; y: number } | null => {
      if (event && isLocalControlTarget(event.target)) return null;

      if (pointerLockPosition?.current) {
        const pos = pointerLockPosition.current;
        return { x: pos.x, y: pos.y };
      }

      if (!event) return null;

      const container = containerRef.current;
      if (!container) return null;

      // Against the picture, not the element around it. The remote screen is
      // rendered `object-contain`, so it is letterboxed whenever its aspect
      // ratio differs from the viewer's window — and normalizing against the
      // element then offsets and rescales every coordinate by however much
      // dead space there is. Opening a side panel is enough to put clicks
      // visibly above or below what the guest aimed at.
      const video = container.querySelector('video');
      const target = video ?? container;
      const rect = target.getBoundingClientRect();

      return normalizedPointOnVideo(
        event.clientX,
        event.clientY,
        rect,
        video?.videoWidth ?? 0,
        video?.videoHeight ?? 0
      );
    },
    [containerRef, pointerLockPosition]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: MouseEvent, fromPointer = false) => {
      if (shouldIgnoreFollowUpMouse(lastPointerEventRef.current, Date.now(), fromPointer)) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      // Only send input event if we have control
      if (!canSendInput) return;

      const inputEvent: MouseMoveEvent = {
        type: 'mouse',
        action: 'move',
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (event: MouseEvent, fromPointer = false) => {
      if (!canSendInput) return;

      // Skip if a pointer event just fired (Chromium fires both).
      if (shouldIgnoreFollowUpMouse(lastPointerEventRef.current, Date.now(), fromPointer)) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'down',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      heldButtonsRef.current.add(inputEvent.button);
      // Keep receiving events if the drag leaves the video, so the matching
      // "up" is never lost.
      const target = event.currentTarget;
      if (target instanceof Element && 'setPointerCapture' in target) {
        const pointerId = (event as MouseEvent & { pointerId?: number }).pointerId;
        if (typeof pointerId === 'number') {
          try {
            target.setPointerCapture(pointerId);
          } catch {
            // Not a pointer event (or already captured) — harmless.
          }
        }
      }

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (event: MouseEvent, fromPointer = false) => {
      if (!canSendInput) return;

      // Skip if a pointer event just fired.
      if (shouldIgnoreFollowUpMouse(lastPointerEventRef.current, Date.now(), fromPointer)) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'up',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      heldButtonsRef.current.delete(inputEvent.button);
      onInputEvent(inputEvent);
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // No separate click/dblclick events: the host OS derives clicks and
  // double-clicks from the down/up pair. Sending them as well actuated every
  // click twice.

  // Handle mouse wheel/scroll
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!canSendInput) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseScrollEvent = {
        type: 'mouse',
        action: 'scroll',
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        // Without this the host cannot tell a trackpad's pixel deltas from a
        // wheel's notches, and treats every 3px of a two-finger drag as a full
        // wheel click. See ScrollAccumulator in @profullstack/remote-input.
        deltaMode: event.deltaMode,
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  /** Send an "up" for everything still held, so the host never sticks. */
  const releaseHeldInput = useCallback(() => {
    for (const button of heldButtonsRef.current) {
      onInputEvent({ type: 'mouse', action: 'up', button, x: 0.5, y: 0.5 });
    }
    heldButtonsRef.current.clear();

    for (const code of heldKeysRef.current) {
      onInputEvent({
        type: 'keyboard',
        action: 'up',
        key: code,
        code,
        modifiers: { ctrl: false, alt: false, shift: false, meta: false },
      });
    }
    heldKeysRef.current.clear();
  }, [onInputEvent]);

  // Handle key down
  const handleKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (!canSendInput) return;
      if (isLocalControlTarget(event.target)) return;

      // Don't capture browser shortcuts
      if (event.altKey && event.key === 'Tab') return;
      if (event.ctrlKey && event.key === 'w') return;
      if (event.ctrlKey && event.key === 't') return;
      if (event.key === 'F11') return;

      const inputEvent: KeyboardInputEvent = {
        type: 'keyboard',
        action: 'down',
        key: event.key,
        code: event.code,
        modifiers: modifiersFromDomEvent(event, viewerPlatform),
      };

      heldKeysRef.current.add(inputEvent.code);
      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [canSendInput, onInputEvent, viewerPlatform]
  );

  // Handle key up
  const handleKeyUp = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (!canSendInput) return;
      if (isLocalControlTarget(event.target)) return;

      const inputEvent: KeyboardInputEvent = {
        type: 'keyboard',
        action: 'up',
        key: event.key,
        code: event.code,
        modifiers: modifiersFromDomEvent(event, viewerPlatform),
      };

      heldKeysRef.current.delete(inputEvent.code);
      onInputEvent(inputEvent);
    },
    [canSendInput, onInputEvent, viewerPlatform]
  );

  // Handle context menu (right-click)
  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;
      event.preventDefault();
    },
    [canSendInput]
  );

  // Pointer events fire before mouse events in Chromium, and on some trackpads
  // only pointer events fire at all. Delegate to the mouse handlers, then mark
  // the timestamp so the mouse-handler dedup skips the follow-up mouse event.
  const handlePointerDown = useCallback(
    (event: PointerEvent) => {
      handleMouseDown(event as unknown as MouseEvent, true);
      lastPointerEventRef.current = Date.now();
    },
    [handleMouseDown]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      handleMouseUp(event as unknown as MouseEvent, true);
      lastPointerEventRef.current = Date.now();
    },
    [handleMouseUp]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      handleMouseMove(event as unknown as MouseEvent, true);
      lastPointerEventRef.current = Date.now();
    },
    [handleMouseMove]
  );

  // Start capturing input
  const startCapture = useCallback(() => {
    setIsCapturing(true);
  }, []);

  // Stop capturing input
  const stopCapture = useCallback(() => {
    releaseHeldInput();
    setIsCapturing(false);
  }, [releaseHeldInput]);

  // Attach/detach event listeners
  useEffect(() => {
    if (!enabled || !isCapturing) return;

    const container = containerRef.current;
    if (!container) return;

    // Mouse events on container
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    // Pointer events cover trackpads that don't fire mouse events.
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('contextmenu', handleContextMenu);

    // Keyboard events on document (when container is focused)
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Alt-tabbing or switching apps mid-drag means the matching up events
    // never arrive; let go of everything rather than stranding the host.
    window.addEventListener('blur', releaseHeldInput);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseHeldInput);
      // Unmounting while held (navigation, disconnect) must not strand the host.
      releaseHeldInput();
    };
  }, [
    enabled,
    isCapturing,
    containerRef,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
    handleContextMenu,
    handlePointerDown,
    handlePointerUp,
    handlePointerMove,
    handleKeyDown,
    handleKeyUp,
    releaseHeldInput,
  ]);

  return {
    isCapturing,
    startCapture,
    stopCapture,
  };
}
