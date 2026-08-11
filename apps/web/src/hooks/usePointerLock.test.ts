/**
 * The pointer lock lifecycle, which shipped untested.
 *
 * The pure delta maths had thorough tests; the state machine around it had
 * none, and that is where the failures were: a lock that was wanted but never
 * granted still redirected every coordinate, and an Escape was answered by
 * immediately asking for the lock back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePointerLock } from './usePointerLock';

/**
 * jsdom implements neither pointer lock nor its events, so the browser half is
 * modelled here: requestPointerLock is granted or denied on demand, and the
 * corresponding event is dispatched the way Chromium does.
 */
function installPointerLock(): {
  grant: (element: Element) => void;
  deny: () => void;
  release: () => void;
  requests: Element[];
} {
  const requests: Element[] = [];
  let current: Element | null = null;

  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => current,
  });

  Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
    requests.push(this);
    return undefined as unknown as Promise<void>;
  };

  document.exitPointerLock = () => {
    current = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  };

  return {
    grant(element: Element) {
      current = element;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
    deny() {
      current = null;
      document.dispatchEvent(new Event('pointerlockerror'));
    },
    release() {
      current = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
    requests,
  };
}

describe('usePointerLock', () => {
  let browser: ReturnType<typeof installPointerLock>;
  let element: HTMLDivElement;

  beforeEach(() => {
    browser = installPointerLock();
    element = document.createElement('div');
    document.body.append(element);
  });

  it('is not locked until the browser says so', () => {
    const { result } = renderHook(() => usePointerLock({ onMove: vi.fn() }));

    act(() => {
      result.current.lock(element);
    });

    // Requested, but not granted. Anything that treats this as locked will send
    // coordinates from a virtual pointer the guest is not steering.
    expect(browser.requests).toHaveLength(1);
    expect(result.current.isLocked).toBe(false);

    act(() => {
      browser.grant(element);
    });
    expect(result.current.isLocked).toBe(true);
  });

  // Chromium refuses a lock during the ~1s cooldown after an Escape, and
  // without pointerlockerror a refusal is indistinguishable from a pending
  // request that never resolves.
  it('stays unlocked when the request is denied', () => {
    const { result } = renderHook(() => usePointerLock({ onMove: vi.fn() }));

    act(() => {
      result.current.lock(element);
      browser.deny();
    });

    expect(result.current.isLocked).toBe(false);
  });

  // Escape exits the lock but not fullscreen, so the caller would see
  // "fullscreen, granted, unlocked" and ask again. This flag is what tells it
  // the guest wants their cursor back.
  it('reports a release the guest initiated', () => {
    const { result } = renderHook(() => usePointerLock({ onMove: vi.fn() }));

    act(() => {
      result.current.lock(element);
      browser.grant(element);
    });
    expect(result.current.wasReleasedByUser).toBe(false);

    act(() => {
      browser.release();
    });

    expect(result.current.isLocked).toBe(false);
    expect(result.current.wasReleasedByUser).toBe(true);
  });

  // Our own unlock (leaving fullscreen, control revoked) is not the guest
  // pressing Escape, and latching it as such would block the next deliberate
  // lock for the rest of the session.
  it('does not mistake its own unlock for the guest pressing Escape', () => {
    const { result } = renderHook(() => usePointerLock({ onMove: vi.fn() }));

    act(() => {
      result.current.lock(element);
      browser.grant(element);
    });

    act(() => {
      result.current.unlock();
    });

    expect(result.current.isLocked).toBe(false);
    expect(result.current.wasReleasedByUser).toBe(false);
  });

  it('clears the release latch on reset so the guest can re-capture', () => {
    const { result } = renderHook(() => usePointerLock({ onMove: vi.fn() }));

    act(() => {
      result.current.lock(element);
      browser.grant(element);
      browser.release();
    });
    expect(result.current.wasReleasedByUser).toBe(true);

    act(() => {
      result.current.resetPosition();
    });
    expect(result.current.wasReleasedByUser).toBe(false);
  });

  it('accumulates movement deltas into a clamped virtual position', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => usePointerLock({ onMove }));

    // The hook measures the surface to convert pixels into a fraction of it.
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
    } as DOMRect);

    act(() => {
      result.current.lock(element);
      browser.grant(element);
    });

    act(() => {
      document.dispatchEvent(
        Object.assign(new MouseEvent('mousemove'), { movementX: 100, movementY: 50 })
      );
    });

    expect(onMove).toHaveBeenCalledWith(0.6, 0.6, true);
    expect(result.current.positionRef.current).toEqual({ x: 0.6, y: 0.6 });
  });

  // The point of the whole feature: pushing past the top edge pins the pointer
  // there instead of the guest's real cursor leaving the window.
  it('pins at an edge when the guest overshoots', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => usePointerLock({ onMove }));

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
    } as DOMRect);

    act(() => {
      result.current.lock(element);
      browser.grant(element);
    });

    act(() => {
      document.dispatchEvent(
        Object.assign(new MouseEvent('mousemove'), { movementX: 0, movementY: -5000 })
      );
    });

    expect(result.current.positionRef.current.y).toBe(0);
  });

  it('ignores movement once the lock is gone', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => usePointerLock({ onMove }));

    act(() => {
      result.current.lock(element);
      browser.grant(element);
      browser.release();
    });
    onMove.mockClear();

    act(() => {
      document.dispatchEvent(
        Object.assign(new MouseEvent('mousemove'), { movementX: 100, movementY: 100 })
      );
    });

    expect(onMove).not.toHaveBeenCalled();
  });
});
