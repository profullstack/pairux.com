import { useCallback, useEffect, useState } from 'react';
import { getContainRect, type ContainRect } from '@pairux/shared-types';

/**
 * Where the remote screen's picture sits inside its container, in pixels.
 *
 * Anything drawn over the video has to be positioned against the picture
 * rather than the element: `object-contain` letterboxes the stream whenever
 * its aspect ratio differs from the window's, and a percentage of the
 * container is not a percentage of the picture. Positioning content against
 * the wrong rectangle makes it drift from the picture it belongs to.
 *
 * Recomputed on resize and once the stream's dimensions are known, since
 * `videoWidth` is 0 until metadata arrives.
 */
export function useVideoContentRect(
  containerRef: React.RefObject<HTMLElement | null>
): ContainRect | null {
  const [rect, setRect] = useState<ContainRect | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const video = container?.querySelector('video');
    if (!container || !video) {
      setRect(null);
      return;
    }

    const bounds = video.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();
    const content = getContainRect(
      bounds.width,
      bounds.height,
      video.videoWidth,
      video.videoHeight
    );

    // Container-relative, because the overlay is positioned inside it.
    setRect({
      x: bounds.left - containerBounds.left + content.x,
      y: bounds.top - containerBounds.top + content.y,
      width: content.width,
      height: content.height,
    });
  }, [containerRef]);

  useEffect(() => {
    measure();

    const container = containerRef.current;
    const video = container?.querySelector('video');
    if (!container) return;

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (video) {
      observer.observe(video);
      // The picture's shape is unknown until the stream reports it, and it can
      // change mid-session when the host switches which screen they share.
      video.addEventListener('loadedmetadata', measure);
      video.addEventListener('resize', measure);
    }

    return () => {
      observer.disconnect();
      if (video) {
        video.removeEventListener('loadedmetadata', measure);
        video.removeEventListener('resize', measure);
      }
    };
  }, [containerRef, measure]);

  return rect;
}
