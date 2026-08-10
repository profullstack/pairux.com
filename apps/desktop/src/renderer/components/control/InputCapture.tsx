import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { InputEvent, ControlStateUI } from '@pairux/shared-types';
import { useRemoteControl } from '@/hooks/useRemoteControl';
import { usePointerLock } from '@/hooks/usePointerLock';
import { Fullscreen } from 'lucide-react';

interface InputCaptureProps {
  children: ReactNode;
  enabled: boolean;
  controlState: ControlStateUI;
  onInputEvent: (event: InputEvent) => void;
  onCursorMove?: ((x: number, y: number, visible: boolean) => void) | undefined;
  className?: string;
  /** When true, shows a fullscreen toggle and enables pointer lock. */
  allowFullscreen?: boolean;
}

/**
 * Captures mouse and keyboard over the remote video and forwards it to the
 * host. Coordinates are normalized against this container, so the host maps
 * them onto its own screen regardless of how the video is scaled here.
 *
 * In fullscreen mode with control granted, pointer lock is enabled: the
 * guest's cursor disappears and movement deltas drive a virtual position,
 * so the guest can push past the screen edge to reach corners and menu bars
 * without their real cursor leaving the video element.
 */
export function InputCapture({
  children,
  enabled,
  controlState,
  onInputEvent,
  onCursorMove,
  className = '',
  allowFullscreen = false,
}: InputCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const locking = controlState === 'granted' && isFullscreen;

  // Virtual position under pointer lock: where the guest aims, independent of
  // where their real cursor is. Fed into useRemoteControl so click coordinates
  // always come from the right place.
  const virtualPositionRef = useRef({ x: 0.5, y: 0.5 });

  const handlePointerMove = useCallback(
    (x: number, y: number, visible: boolean) => {
      virtualPositionRef.current = { x, y };
      onCursorMove?.(x, y, visible);
    },
    [onCursorMove]
  );

  const { isLocked, lock, unlock, resetPosition } = usePointerLock({
    onMove: handlePointerMove,
  });

  const { isCapturing, startCapture, stopCapture } = useRemoteControl({
    enabled,
    controlState,
    containerRef,
    onInputEvent,
    onCursorMove,
    // When locked, coordinates come from the virtual position rather than
    // the event's absolute clientX/Y (which are 0 under lock).
    pointerLockPosition: locking ? virtualPositionRef : undefined,
  });

  // Capture only while control is actually granted.
  useEffect(() => {
    if (controlState === 'granted' && enabled) {
      startCapture();
    } else if (controlState !== 'granted' && isCapturing) {
      stopCapture();
    }
  }, [controlState, enabled, isCapturing, startCapture, stopCapture]);

  // Keyboard events need focus on the container.
  useEffect(() => {
    if (isCapturing && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isCapturing]);

  // Pointer lock lifecycle: request when fullscreen + granted, release when
  // fullscreen ends or control is revoked.
  useEffect(() => {
    if (locking && containerRef.current && !isLocked) {
      lock(containerRef.current);
    } else if (!locking && isLocked) {
      unlock();
      resetPosition();
    }
  }, [locking, isLocked, lock, unlock, resetPosition]);

  // Reset on unlock so a re-lock starts from centre, not wherever the guest
  // stopped moving last time.
  useEffect(() => {
    if (!isLocked) {
      // Let the next absolute-coordinate move correct the position.
      virtualPositionRef.current = { x: 0.5, y: 0.5 };
    }
  }, [isLocked]);

  // Watch fs exit so state stays in sync when the user presses Escape or
  // exits fullscreen through a browser shortcut.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        if (isLocked) {
          unlock();
          resetPosition();
        }
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [isLocked, unlock, resetPosition]);

  const toggleFullscreen = useCallback(() => {
    // This handler fires from a button click, which is a user gesture that
    // fullscreen and pointer lock both require.
    if (!containerRef.current) return;

    const exit = isFullscreen;
    if (exit) {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
      setIsFullscreen(false);
    } else {
      void containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    }
  }, [isFullscreen]);

  return (
    <div
      ref={containerRef}
      tabIndex={enabled ? 0 : -1}
      className={`relative outline-none ${className} ${
        controlState === 'granted' ? 'cursor-none' : ''
      }`}
      style={{
        userSelect: isCapturing ? 'none' : 'auto',
      }}
    >
      {children}

      {controlState === 'granted' && (
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-green-500/50" />
      )}

      {allowFullscreen && controlState === 'granted' && (
        <button
          onClick={toggleFullscreen}
          className="absolute right-2 top-2 z-10 rounded-lg bg-black/40 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen + pointer lock'}
        >
          <Fullscreen className="h-4 w-4" />
          {isLocked && (
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-green-400" />
          )}
        </button>
      )}
    </div>
  );
}
