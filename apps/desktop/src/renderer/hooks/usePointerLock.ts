import { useCallback, useEffect, useRef, useState } from 'react';
import { getContainRect } from '@pairux/shared-types';
import { advanceVirtualPointer } from '@/lib/virtualPointer';

interface UsePointerLockOptions {
  /** Called with the current virtual position on every movement. */
  onMove: (x: number, y: number, visible: boolean) => void;
}

interface UsePointerLockReturn {
  /** True only once the browser has actually granted the lock. */
  isLocked: boolean;
  /**
   * The guest released the lock themselves (Escape, or switching apps).
   *
   * Distinct from "not locked": the caller must not immediately ask for it
   * back, or Escape does nothing and the cursor never returns.
   */
  wasReleasedByUser: boolean;
  /** Live virtual position. A ref, because it changes far too often to render. */
  positionRef: React.RefObject<{ x: number; y: number }>;
  /** Request pointer lock on this element. Must be called from a user gesture. */
  lock: (element: Element) => void;
  /** Exit pointer lock. */
  unlock: () => void;
  /** Reset the virtual position to centre and allow locking again. */
  resetPosition: () => void;
}

/**
 * Pointer lock with virtual position tracking.
 *
 * Under pointer lock there is no cursor position to read — the browser reports
 * movement deltas instead — so the remote position is accumulated and clamped
 * to the screen. This fixes the core problem with absolute-coordinate mapping:
 * the guest's real cursor must be exactly on the video edge to reach the host's
 * screen edge, and a few pixels further leaves the window entirely. With
 * pointer lock the guest can push past an edge and stay there, which is what
 * reaching a menu bar or a corner requires.
 */
export function usePointerLock({ onMove }: UsePointerLockOptions): UsePointerLockReturn {
  const [isLocked, setIsLocked] = useState(false);
  const [wasReleasedByUser, setWasReleasedByUser] = useState(false);
  const positionRef = useRef({ x: 0.5, y: 0.5 });
  const lockedElementRef = useRef<Element | null>(null);
  // Set while we are the ones exiting, so the exit is not misread as the guest
  // pressing Escape — which would latch `wasReleasedByUser` and stop the next
  // deliberate lock from ever being granted.
  const exitingRef = useRef(false);
  // A request is in flight. The browser answers asynchronously, so without this
  // the lifecycle effect fires a second request in the render between asking
  // and being answered — and a burst of requests is exactly what Chromium's
  // abuse heuristics refuse.
  const pendingRef = useRef(false);

  // The size of the *picture*, not of the element around it.
  //
  // The remote screen is letterboxed by `object-contain` whenever its aspect
  // ratio differs from this window's, and movement has to be scaled against
  // what the guest can actually see. Measuring the element instead makes the
  // pointer travel too slowly along whichever axis carries the dead space, so
  // crossing the screen takes further than it should on one axis and not the
  // other — the drift that reads as "the cursor doesn't go where I push it".
  const getSurfaceSize = useCallback((): { width: number; height: number } => {
    const el = lockedElementRef.current;
    if (!el) return { width: 1, height: 1 };

    const video = el.querySelector('video');
    const rect = (video ?? el).getBoundingClientRect();
    const content = getContainRect(
      rect.width,
      rect.height,
      video?.videoWidth ?? 0,
      video?.videoHeight ?? 0
    );

    return { width: content.width || 1, height: content.height || 1 };
  }, []);

  const handleMovement = useCallback(
    (diffX: number, diffY: number) => {
      const { width, height } = getSurfaceSize();
      positionRef.current = advanceVirtualPointer(positionRef.current, diffX, diffY, width, height);
      onMove(positionRef.current.x, positionRef.current.y, true);
    },
    [onMove, getSurfaceSize]
  );

  // Under pointer lock clientX/Y stop advancing and movementX/Y carries the
  // actual motion. Chromium normally emits both pointermove and mousemove for
  // the same physical movement, while certain macOS trackpad/Electron paths
  // emit only pointermove. Consume both without injecting either twice.
  useEffect(() => {
    if (!isLocked) return;

    let lastPointerMoveAt = Number.NEGATIVE_INFINITY;
    const move = (event: MouseEvent) => {
      handleMovement(event.movementX, event.movementY);
    };
    const onPointerMove = (event: PointerEvent) => {
      lastPointerMoveAt = performance.now();
      move(event);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (performance.now() - lastPointerMoveAt < 16) return;
      move(event);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [isLocked, handleMovement]);

  // Detect when the lock is granted, and when it goes away.
  useEffect(() => {
    const onChange = () => {
      pendingRef.current = false;
      const locked =
        lockedElementRef.current !== null &&
        document.pointerLockElement === lockedElementRef.current;
      setIsLocked(locked);

      if (locked) {
        console.info('[PointerLock] Pointer lock acquired');
        setWasReleasedByUser(false);
        return;
      }

      lockedElementRef.current = null;
      // Escape, Cmd+Tab, or the browser deciding it has had enough. Whichever
      // it was, the guest now has their real cursor back and must not have it
      // taken away again until they ask. Chromium also refuses a re-lock for
      // about a second after an Escape, so retrying here would fail silently
      // and strand the session with neither a lock nor real coordinates.
      if (!exitingRef.current) {
        console.warn('[PointerLock] Pointer lock released or denied');
        setWasReleasedByUser(true);
      }
      exitingRef.current = false;
    };

    document.addEventListener('pointerlockchange', onChange);
    // Chromium fires this instead when the request is denied — during the
    // post-Escape cooldown, or without a user gesture. Without handling it, a
    // failed lock looks exactly like one that simply has not been granted yet.
    document.addEventListener('pointerlockerror', onChange);
    return () => {
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onChange);
    };
  }, []);

  const lock = useCallback((element: Element) => {
    if (pendingRef.current || document.pointerLockElement === element) return;
    pendingRef.current = true;
    lockedElementRef.current = element;
    exitingRef.current = false;
    // Chromium is allowed to reject pointer lock on an unfocused element. The
    // guest's pointer-down is our user gesture, so focus synchronously before
    // making the request rather than waiting for React's focus effect.
    if (element instanceof HTMLElement) {
      element.focus({ preventScroll: true });
    }
    // Pointer lock requires a user gesture, which the button click provides.
    // The promise is intentionally unawaited: older Chromium returns undefined
    // here, and the outcome is observed through the events above either way.
    console.info('[PointerLock] Requesting pointer lock');
    void (element.requestPointerLock() as unknown as Promise<void> | undefined)?.catch(
      (error: unknown) => {
        // Denied. The event handler has already put us back in the unlocked
        // state; swallowing keeps it off the console as an unhandled rejection.
        pendingRef.current = false;
        console.warn('[PointerLock] Request was rejected', error);
      }
    );
  }, []);

  const unlock = useCallback(() => {
    if (document.pointerLockElement) {
      exitingRef.current = true;
      document.exitPointerLock();
    }
  }, []);

  const resetPosition = useCallback(() => {
    positionRef.current = { x: 0.5, y: 0.5 };
    setWasReleasedByUser(false);
  }, []);

  return {
    isLocked,
    wasReleasedByUser,
    positionRef,
    lock,
    unlock,
    resetPosition,
  };
}
