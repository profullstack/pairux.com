/**
 * The wiring between fullscreen, pointer lock and coordinate source.
 *
 * The bug worth a test: wanting the lock was treated as having it. A denied
 * request left the guest looking at their own cursor over a fullscreen video
 * while every click was sent from a virtual pointer stuck at the centre of the
 * screen — silent, and worse than the edge-reaching problem it was added for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { InputEvent } from '@pairux/shared-types';
import { InputCapture } from './InputCapture';

function installBrowserApis(): {
  grantLock: (element: Element) => void;
  denyLock: () => void;
  lockRequests: Element[];
  grantFullscreen: () => Promise<void>;
} {
  const lockRequests: Element[] = [];
  let locked: Element | null = null;
  let fullscreen: Element | null = null;
  let resolveFullscreen: (() => void) | null = null;

  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => locked,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });

  Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
    lockRequests.push(this);
    return undefined as unknown as Promise<void>;
  };
  Element.prototype.requestFullscreen = () =>
    // Deliberately left pending: the caller must not assume it is fullscreen
    // until the browser says so, which is the behaviour under test. Nothing
    // reads *which* element is fullscreen, only whether one is, so the root
    // stands in for it.
    new Promise<void>((resolve) => {
      resolveFullscreen = () => {
        fullscreen = document.documentElement;
        resolve();
      };
    });
  document.exitPointerLock = () => {
    locked = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  };

  return {
    grantLock(element: Element) {
      locked = element;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
    denyLock() {
      locked = null;
      document.dispatchEvent(new Event('pointerlockerror'));
    },
    lockRequests,
    async grantFullscreen() {
      resolveFullscreen?.();
      await Promise.resolve();
    },
  };
}

function renderCapture(onInputEvent: (event: InputEvent) => void) {
  const result = render(
    <InputCapture enabled controlState="granted" onInputEvent={onInputEvent} allowFullscreen>
      <video />
    </InputCapture>
  );

  const container = result.container.firstElementChild as HTMLDivElement;
  const rect = { left: 0, top: 0, width: 1000, height: 500 } as DOMRect;
  // A 1000x500 surface at the origin, so a click at (250, 250) is (0.25, 0.5).
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect);
  // The lock measures the video, not the container, so movement is scaled to
  // the picture rather than to any padding around it.
  const video = container.querySelector('video');
  if (video) vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect);

  return { ...result, container };
}

function clickAt(container: Element, clientX: number, clientY: number): void {
  container.dispatchEvent(
    new MouseEvent('mousedown', { clientX, clientY, button: 0, bubbles: true })
  );
}

describe('InputCapture pointer lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The guest's complaint that drove this: their real cursor walks out of the
  // video the moment they push toward an edge, so they cannot reach a menu bar,
  // a corner, or a window's controls. Clicking the picture takes the pointer.
  it('captures the pointer when the guest clicks the picture', () => {
    const browser = installBrowserApis();
    const { container } = renderCapture(vi.fn());

    act(() => {
      clickAt(container, 250, 250);
    });

    expect(browser.lockRequests).toHaveLength(1);
  });

  // That first click is how the guest reaches for the window, not for whatever
  // happens to be under the pointer at the time.
  it('does not forward the click that takes control', () => {
    installBrowserApis();
    const onInputEvent = vi.fn();
    const { container } = renderCapture(onInputEvent);

    act(() => {
      clickAt(container, 250, 250);
    });

    expect(onInputEvent).not.toHaveBeenCalled();
  });

  it('uses the virtual position once the lock is granted', () => {
    const browser = installBrowserApis();
    const onInputEvent = vi.fn();
    const { container } = renderCapture(onInputEvent);

    act(() => {
      clickAt(container, 250, 250);
      browser.grantLock(container);
    });

    act(() => {
      document.dispatchEvent(
        Object.assign(new MouseEvent('mousemove'), { movementX: 100, movementY: 50 })
      );
    });

    onInputEvent.mockClear();
    act(() => {
      // clientX/Y stop advancing under lock, so a click reporting (0,0) must
      // still land where the virtual pointer is.
      clickAt(container, 0, 0);
    });

    expect(onInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'down', x: 0.6, y: 0.6 })
    );
  });

  // A refusal must not leave the guest unable to do anything. Chromium refuses
  // during the cooldown after an Escape, and some embeddings refuse outright.
  it('falls back to absolute coordinates when the lock is refused', () => {
    vi.useFakeTimers();
    try {
      const browser = installBrowserApis();
      const onInputEvent = vi.fn();
      const { container } = renderCapture(onInputEvent);

      act(() => {
        clickAt(container, 250, 250);
        browser.denyLock();
      });

      // The component waits briefly before concluding the lock is not coming.
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      onInputEvent.mockClear();
      act(() => {
        clickAt(container, 250, 250);
      });

      expect(onInputEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'down', x: 0.25, y: 0.5 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Escape releases the lock. The lifecycle effect used to see "granted, not
  // locked" on the next render and ask for it straight back, so Escape appeared
  // to do nothing.
  it('does not grab the pointer back after the guest presses Escape', () => {
    const browser = installBrowserApis();
    const { container } = renderCapture(vi.fn());

    act(() => {
      clickAt(container, 250, 250);
      browser.grantLock(container);
    });

    const requestsBefore = browser.lockRequests.length;

    act(() => {
      document.exitPointerLock();
    });

    expect(browser.lockRequests).toHaveLength(requestsBefore);
  });

  it('re-captures when the guest clicks again after releasing', () => {
    const browser = installBrowserApis();
    const { container } = renderCapture(vi.fn());

    act(() => {
      clickAt(container, 250, 250);
      browser.grantLock(container);
      document.exitPointerLock();
    });

    const requestsBefore = browser.lockRequests.length;
    act(() => {
      clickAt(container, 250, 250);
    });

    expect(browser.lockRequests.length).toBe(requestsBefore + 1);
  });

  it('goes back to asking for control when control is revoked', () => {
    const browser = installBrowserApis();
    const { container, rerender } = renderCapture(vi.fn());

    act(() => {
      clickAt(container, 250, 250);
      browser.grantLock(container);
    });

    act(() => {
      rerender(
        <InputCapture enabled controlState="view-only" onInputEvent={vi.fn()} allowFullscreen>
          <video />
        </InputCapture>
      );
    });

    expect(document.pointerLockElement).toBeNull();
  });
});
