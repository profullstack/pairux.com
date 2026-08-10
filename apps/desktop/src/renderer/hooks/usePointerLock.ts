import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceVirtualPointer } from '@/lib/virtualPointer';

interface UsePointerLockOptions {
  /** Called with the current virtual position on every movement. */
  onMove: (x: number, y: number, visible: boolean) => void;
}

interface UsePointerLockReturn {
  isLocked: boolean;
  /** Normalized virtual pointer position. */
  position: { x: number; y: number };
  /** Request pointer lock on this element. */
  lock: (element: Element) => void;
  /** Exit pointer lock. */
  unlock: () => void;
  /** Reset the virtual position to centre. */
  resetPosition: () => void;
}

/**
 * Pointer lock with virtual position tracking.
 *
 * Under pointer lock there is no cursor position to read — the browser reports
 * movement deltas instead — so the remote position is accumulated and clamped
 * to the screen. This fixes the core problem with absolute-coordinate mapping:
 * the guest's real cursor must be exactly on the video edge to reach the
 * host's screen edge, and a few pixels further leaves the window entirely.
 * With pointer lock the guest can push past an edge and stay there, which is
 * what reaching a menu bar or a corner requires.
 */
export function usePointerLock({ onMove }: UsePointerLockOptions): UsePointerLockReturn {
  const [isLocked, setIsLocked] = useState(false);
  const positionRef = useRef({ x: 0.5, y: 0.5 });
  const lockedElementRef = useRef<Element | null>(null);

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

  // PointerLock API: movementX/Y come from the pointerlockchange handler on
  // the document, since the mousemove event does not fire under lock in
  // Chromium without the right flags.
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

  // Detect when the user exits pointer lock (Escape, Cmd+Tab, etc.).
  useEffect(() => {
    const onChange = () => {
      const locked = document.pointerLockElement === lockedElementRef.current;
      setIsLocked(locked);
      if (!locked) {
        lockedElementRef.current = null;
        // The guest's real cursor reappeared wherever it was, so the virtual
        // position is now stale. The next absolute-coordinate move will
        // correct it.
      }
    };

    document.addEventListener('pointerlockchange', onChange);
    return () => {
      document.removeEventListener('pointerlockchange', onChange);
    };
  }, []);

  const lock = useCallback((element: Element) => {
    lockedElementRef.current = element;
    // Pointer lock requires a user gesture, which the button click provides.
    // The promise is intentionally unawaited: the result is observed via the
    // pointerlockchange event on the document.
    void element.requestPointerLock();
  }, []);

  const unlock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, []);

  const resetPosition = useCallback(() => {
    positionRef.current = { x: 0.5, y: 0.5 };
  }, []);

  return {
    isLocked,
    position: positionRef.current,
    lock,
    unlock,
    resetPosition,
  };
}
