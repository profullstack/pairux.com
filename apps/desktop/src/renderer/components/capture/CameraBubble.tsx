import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getContainRect, clamp } from '@/lib/containRect';
import type { BubbleGeometry } from '@/hooks/useScreenCameraCompositor';

interface CameraBubbleProps {
  /** The webcam stream to display. */
  stream: MediaStream | null;
  /** Pixel size of the container the bubble lives in. */
  containerWidth: number;
  containerHeight: number;
  /**
   * Native size of the underlying screen video, used to align the bubble with the
   * letterboxed picture. Pass 0/0 when there is no screen (voice-only camera sharing),
   * in which case the bubble floats freely within the container.
   */
  videoWidth: number;
  videoHeight: number;
  /** Bubble geometry, normalized to the frame (see {@link BubbleGeometry}). */
  geometry: BubbleGeometry;
  /** Called as the user drags or resizes the bubble. */
  onChange: (geometry: BubbleGeometry) => void;
  /** Called when the user dismisses the bubble (turns the camera off). */
  onClose: () => void;
}

const MIN_SIZE = 0.1;
const MAX_SIZE = 0.4;

/**
 * Draggable circular self-view (the Loom-style camera bubble). Lives on top of the
 * capture preview; users position it before recording and can drag it any time. It is
 * always optional — the close button turns the camera off entirely.
 */
export function CameraBubble({
  stream,
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight,
  geometry,
  onChange,
  onClose,
}: CameraBubbleProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    geometry: BubbleGeometry;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // The picture rectangle the bubble is positioned within (matches `object-contain`).
  const rect = getContainRect(containerWidth, containerHeight, videoWidth, videoHeight);
  const diameter = clamp(geometry.size, MIN_SIZE, MAX_SIZE) * rect.height;
  const radius = diameter / 2;
  const centerX = rect.x + clamp(geometry.x, 0, 1) * rect.width;
  const centerY = rect.y + clamp(geometry.y, 0, 1) * rect.height;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        geometry,
      };
      setIsDragging(true);
    },
    [geometry]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start || rect.width === 0 || rect.height === 0) return;

      const dx = (e.clientX - start.pointerX) / rect.width;
      const dy = (e.clientY - start.pointerY) / rect.height;

      // Keep the whole circle inside the picture rectangle.
      const radiusX = (start.geometry.size * rect.height) / 2 / rect.width;
      const radiusY = start.geometry.size / 2;

      onChange({
        ...start.geometry,
        x: clamp(start.geometry.x + dx, radiusX, 1 - radiusX),
        y: clamp(start.geometry.y + dy, radiusY, 1 - radiusY),
      });
    },
    [onChange, rect.width, rect.height]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  // Scroll to resize the bubble.
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const next = clamp(geometry.size + (e.deltaY < 0 ? 0.01 : -0.01), MIN_SIZE, MAX_SIZE);
      onChange({ ...geometry, size: next });
    },
    [geometry, onChange]
  );

  return (
    <div
      data-testid="camera-bubble"
      role="button"
      tabIndex={0}
      aria-label="Drag to reposition your camera"
      className={`group absolute touch-none select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        left: centerX - radius,
        top: centerY - radius,
        width: diameter,
        height: diameter,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full rounded-full border-2 border-white/90 object-cover shadow-lg"
        style={{ transform: 'scaleX(-1)' }}
      />
      <button
        type="button"
        data-testid="camera-bubble-close"
        aria-label="Turn camera off"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
