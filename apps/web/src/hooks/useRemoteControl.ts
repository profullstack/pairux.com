import { useCallback, useRef, useEffect, useState } from 'react';
import type {
  InputEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardEvent as KeyboardInputEvent,
  MouseButton,
  ControlStateUI,
} from '@pairux/shared-types';

interface UseRemoteControlOptions {
  enabled: boolean;
  controlState: ControlStateUI;
  containerRef: React.RefObject<HTMLElement | null>;
  onInputEvent: (event: InputEvent) => void;
  onCursorMove?: ((x: number, y: number, visible: boolean) => void) | undefined;
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
  onCursorMove,
}: UseRemoteControlOptions): UseRemoteControlReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const lastCursorUpdateRef = useRef(0);
  const cursorThrottleMs = 16; // ~60fps throttle for cursor updates

  // Check if we can send input (enabled, granted control, and capturing)
  const canSendInput = enabled && controlState === 'granted' && isCapturing;

  // Get relative coordinates (0-1) from a mouse event
  const getRelativeCoords = useCallback(
    (event: MouseEvent): { x: number; y: number } | null => {
      const container = containerRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      // Clamp to valid range
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    },
    [containerRef]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const coords = getRelativeCoords(event);
      if (!coords) return;

      // Always update cursor position (even when view-only)
      const now = Date.now();
      if (now - lastCursorUpdateRef.current >= cursorThrottleMs) {
        lastCursorUpdateRef.current = now;
        onCursorMove?.(coords.x, coords.y, true);
      }

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
    [getRelativeCoords, canSendInput, onCursorMove, onInputEvent]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'down',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'up',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle click
  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'click',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle double click
  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;

      const coords = getRelativeCoords(event);
      if (!coords) return;

      const inputEvent: MouseButtonEvent = {
        type: 'mouse',
        action: 'dblclick',
        button: toMouseButton(event.button),
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

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
        x: coords.x,
        y: coords.y,
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [getRelativeCoords, canSendInput, onInputEvent]
  );

  // Handle mouse leave (cursor left the container)
  const handleMouseLeave = useCallback(() => {
    onCursorMove?.(0, 0, false);
  }, [onCursorMove]);

  // Handle key down
  const handleKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (!canSendInput) return;

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
        modifiers: {
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        },
      };

      onInputEvent(inputEvent);
      event.preventDefault();
    },
    [canSendInput, onInputEvent]
  );

  // Handle key up
  const handleKeyUp = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (!canSendInput) return;

      const inputEvent: KeyboardInputEvent = {
        type: 'keyboard',
        action: 'up',
        key: event.key,
        code: event.code,
        modifiers: {
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        },
      };

      onInputEvent(inputEvent);
    },
    [canSendInput, onInputEvent]
  );

  // Handle context menu (right-click)
  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!canSendInput) return;
      event.preventDefault();
    },
    [canSendInput]
  );

  // Start capturing input
  const startCapture = useCallback(() => {
    setIsCapturing(true);
  }, []);

  // Stop capturing input
  const stopCapture = useCallback(() => {
    setIsCapturing(false);
    onCursorMove?.(0, 0, false);
  }, [onCursorMove]);

  // Attach/detach event listeners
  useEffect(() => {
    if (!enabled || !isCapturing) return;

    const container = containerRef.current;
    if (!container) return;

    // Mouse events on container
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('click', handleClick);
    container.addEventListener('dblclick', handleDoubleClick);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('contextmenu', handleContextMenu);

    // Keyboard events on document (when container is focused)
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('dblclick', handleDoubleClick);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    enabled,
    isCapturing,
    containerRef,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleClick,
    handleDoubleClick,
    handleWheel,
    handleMouseLeave,
    handleContextMenu,
    handleKeyDown,
    handleKeyUp,
  ]);

  return {
    isCapturing,
    startCapture,
    stopCapture,
  };
}
