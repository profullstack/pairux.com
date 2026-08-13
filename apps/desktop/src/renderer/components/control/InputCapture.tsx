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
  className = '',
  allowFullscreen = false,
}: InputCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { isLocked, wasReleasedByUser, positionRef, lock, unlock, resetPosition } = usePointerLock({
    onMove: () => undefined,
  });

  // The guest has asked to drive, by clicking into the picture.
  //
  // Capture is deliberately not tied to fullscreen. Without the pointer held,
  // the guest's real cursor walks straight out of the video the moment they
  // push toward an edge — so they cannot reach a menu bar, a corner, or a
  // window's controls, which is most of what taking control is *for*. Making
  // that conditional on entering fullscreen first put the fix behind a step
  // nobody found.
  const [captureRequested, setCaptureRequested] = useState(false);
  // The browser refused the lock. Rather than leaving the guest unable to do
  // anything, fall back to plain absolute coordinates — worse at the edges,
  // but working.
  const [lockDenied, setLockDenied] = useState(false);

  // Wanting the lock and having it are different states, and conflating them is
  // a silent failure: a request can be denied (no user gesture, or Chromium's
  // cooldown after an Escape) and then the guest sees their real cursor over
  // the video while every click is sent from a virtual position they are not
  // steering. So the lock must be *granted* before coordinates come from
  // anywhere but the event.
  const wantsLock =
    controlState === 'granted' && captureRequested && !wasReleasedByUser && !lockDenied;

  const { isCapturing, startCapture, stopCapture } = useRemoteControl({
    enabled,
    controlState,
    containerRef,
    onInputEvent,
    // Only once the lock is actually held. Under lock the event's clientX/Y
    // stop advancing, so the virtual position is the only real coordinate;
    // outside it, the event is.
    pointerLockPosition: isLocked ? positionRef : undefined,
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

  // Pressing the picture takes control of the pointer.
  //
  // Capture phase, so this runs before useRemoteControl's own mousedown on the
  // same container and can stop the click that *acquires* control from also
  // being sent to the host — the guest is reaching for the window, not for
  // whatever happens to be under it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (controlState !== 'granted' || !enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      if (isLocked || lockDenied) return;
      event.stopPropagation();
      event.preventDefault();
      // Clears the "they pressed Escape" latch, so asking again works.
      resetPosition();
      setCaptureRequested(true);
      lock(container);
    };

    // Pointer lock must be requested in the same trusted pointer gesture.
    // Mouse events are a later compatibility event on Chromium/macOS and can
    // arrive after the browser has already consumed the gesture.
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [controlState, enabled, isLocked, lockDenied, lock, resetPosition]);

  // A refusal is not permanent, but it must not be retried on a loop either.
  // Record it so coordinates stay absolute and the guest keeps working.
  useEffect(() => {
    if (!captureRequested || isLocked) return;
    const timer = setTimeout(() => {
      if (!document.pointerLockElement) setLockDenied(true);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [captureRequested, isLocked]);

  // Control ending resets the whole interaction, so the next grant starts from
  // "click to take control" rather than from whatever state this was left in.
  useEffect(() => {
    if (controlState === 'granted') return;
    setCaptureRequested(false);
    setLockDenied(false);
  }, [controlState]);

  // Pointer lock lifecycle: request when fullscreen and control is granted,
  // release when either ends.
  //
  // `wantsLock` folds in `wasReleasedByUser`, which is what stops this from
  // fighting the guest. Escape releases the lock without leaving fullscreen, so
  // without that flag this effect would see "fullscreen, granted, not locked"
  // one render later and immediately ask for the lock back — Escape would
  // appear to do nothing at all.
  useEffect(() => {
    if (wantsLock && containerRef.current && !isLocked) {
      lock(containerRef.current);
    } else if (!wantsLock && isLocked) {
      unlock();
    }
  }, [wantsLock, isLocked, lock, unlock]);

  // Watch fs exit so state stays in sync when the guest leaves fullscreen
  // through Escape or a browser shortcut rather than the button.
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) return;
      setIsFullscreen(false);
      unlock();
      // Leaving fullscreen is a fresh start: clear both the stale virtual
      // position and the "they pressed Escape" latch, so the button works
      // again next time.
      resetPosition();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [unlock, resetPosition]);

  const toggleFullscreen = useCallback(() => {
    // This handler fires from a button click, which is a user gesture that
    // fullscreen and pointer lock both require.
    const container = containerRef.current;
    if (!container) return;

    if (isFullscreen) {
      // Still fullscreen but no longer locked means the guest pressed Escape to
      // get their cursor back. The obvious next click is "capture it again",
      // not "leave fullscreen" — and asking here rather than from an effect is
      // what makes it work, since this click is the user gesture the browser
      // requires and the cooldown after an Escape has passed.
      if (!isLocked) {
        resetPosition();
        lock(container);
        return;
      }

      if (document.fullscreenElement) void document.exitFullscreen();
      setIsFullscreen(false);
      return;
    }

    // Only claim fullscreen once the browser has actually granted it. Setting
    // the flag optimistically and then having the request rejected leaves the
    // component believing it is fullscreen when it is not, which used to mean
    // clicks were sent from a virtual pointer nobody was steering.
    void container
      .requestFullscreen()
      .then(() => {
        resetPosition();
        setIsFullscreen(true);
      })
      .catch(() => {
        setIsFullscreen(false);
      });
  }, [isFullscreen, isLocked, lock, resetPosition]);

  return (
    <div
      ref={containerRef}
      tabIndex={enabled ? 0 : -1}
      className={`relative outline-none ${className} ${isLocked ? 'cursor-none' : ''}`}
      style={{
        userSelect: isCapturing ? 'none' : 'auto',
      }}
    >
      {children}

      {controlState === 'granted' && (
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-green-500/50" />
      )}

      {controlState === 'granted' && !isLocked && !lockDenied && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-lg bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            Click to control · Esc to release
          </div>
        </div>
      )}

      {controlState === 'granted' && lockDenied && (
        <button
          type="button"
          data-pairux-local-control
          className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/25"
          onClick={() => {
            const container = containerRef.current;
            if (!container) return;
            resetPosition();
            setLockDenied(false);
            setCaptureRequested(true);
            lock(container);
          }}
        >
          <span className="rounded-lg bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            Pointer capture was unavailable · Click to try again
          </span>
        </button>
      )}

      {allowFullscreen && controlState === 'granted' && (
        <button
          data-pairux-local-control
          onClick={toggleFullscreen}
          className="absolute right-2 top-2 z-10 rounded-lg bg-black/40 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
          title={
            !isFullscreen
              ? 'Fullscreen + pointer lock'
              : isLocked
                ? 'Exit fullscreen'
                : 'Capture pointer again'
          }
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
