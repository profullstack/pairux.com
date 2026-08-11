import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Resolve the surface size from the element under lock. The video element
  // inside reports its own dimensions; the lock container's size would include
  // padding and borders, which would under-count the guest's movement.
  const getSurfaceSize = useCallback((): { width: number; height: number } => {
    const el = lockedElementRef.current;
    if (!el) return { width: 1, height: 1 };
    const video = el.querySelector('video');
    const target = video ?? el;
    const rect = target.getBoundingClientRect();
    return { width: rect.width || 1, height: rect.height || 1 };
  }, []);

  const handleMovement = useCallback(
    (diffX: number, diffY: number) => {
      const { width, height } = getSurfaceSize();
      positionRef.current = advanceVirtualPointer(positionRef.current, diffX, diffY, width, height);
      onMove(positionRef.current.x, positionRef.current.y, true);
    },
    [onMove, getSurfaceSize]
  );

  // Under pointer lock the browser keeps firing mousemove on the document, but
  // clientX/Y stop advancing and movementX/Y carry the actual motion. That is
  // the whole reason a virtual position has to be accumulated by hand.
  useEffect(() => {
    if (!isLocked) return;

    const onPointerMove = (event: MouseEvent) => {
      handleMovement(event.movementX, event.movementY);
    };

    document.addEventListener('mousemove', onPointerMove);
    return () => {
      document.removeEventListener('mousemove', onPointerMove);
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
        setWasReleasedByUser(false);
        return;
      }

      lockedElementRef.current = null;
      // Escape, Cmd+Tab, or the browser deciding it has had enough. Whichever
      // it was, the guest now has their real cursor back and must not have it
      // taken away again until they ask. Chromium also refuses a re-lock for
      // about a second after an Escape, so retrying here would fail silently
      // and strand the session with neither a lock nor real coordinates.
      if (!exitingRef.current) setWasReleasedByUser(true);
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
    // Pointer lock requires a user gesture, which the button click provides.
    // The promise is intentionally unawaited: older Chromium returns undefined
    // here, and the outcome is observed through the events above either way.
    void (element.requestPointerLock() as unknown as Promise<void> | undefined)?.catch(() => {
      // Denied. The event handler has already put us back in the unlocked
      // state; swallowing keeps it off the console as an unhandled rejection.
      pendingRef.current = false;
    });
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
