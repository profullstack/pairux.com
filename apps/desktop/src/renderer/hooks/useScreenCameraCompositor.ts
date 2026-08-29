/**
 * Composites a screen-share stream with a circular webcam "bubble" into a single
 * video stream (Loom-style). The bubble position/size are read from a ref every frame
 * so dragging the bubble updates the composite live without restarting the render loop.
 *
 * The returned stream's video track is suitable for both local recording and WebRTC
 * publishing, so what viewers see matches what gets recorded (WYSIWYG).
 */

import { useEffect, useState, type RefObject } from 'react';
import { clamp } from '@/lib/containRect';

export interface BubbleGeometry {
  /** Horizontal center as a fraction (0-1) of the frame width. */
  x: number;
  /** Vertical center as a fraction (0-1) of the frame height. */
  y: number;
  /** Diameter as a fraction (0-1) of the frame height. */
  size: number;
}

interface UseScreenCameraCompositorOptions {
  screenStream: MediaStream | null;
  cameraStream: MediaStream | null;
  geometryRef: RefObject<BubbleGeometry>;
  enabled: boolean;
}

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const FRAME_RATE = 30;
/**
 * captureStream(FRAME_RATE) samples the canvas at most FRAME_RATE times a
 * second, so anything drawn between samples is discarded. requestAnimationFrame
 * fires at the display's refresh rate — 60Hz, 144Hz on a gaming monitor — and
 * `backgroundThrottling: false` (see main/window.ts) keeps it firing at full
 * speed for the entire share, because the host window is backgrounded the whole
 * time by design. Drawing every callback therefore burned 2-5x the pixel
 * bandwidth for frames nobody ever read: a native-resolution 4K canvas is 33MB
 * per clear+draw, which at 144Hz is several GB/s of wasted traffic against the
 * same GPU the desktop is compositing with. Gate the work to the sample rate.
 */
const FRAME_INTERVAL_MS = 1000 / FRAME_RATE;

/** Draw a video into a destination box using `object-cover`, optionally mirrored. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mirror: boolean
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return;

  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  if (mirror) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

function createHiddenVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  void video.play().catch(() => {
    // Autoplay can reject before metadata loads; the render loop tolerates empty frames.
  });
  return video;
}

export function useScreenCameraCompositor({
  screenStream,
  cameraStream,
  geometryRef,
  enabled,
}: UseScreenCameraCompositorOptions): MediaStream | null {
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled || !screenStream || !cameraStream) {
      setOutputStream(null);
      return;
    }

    const canvas = document.createElement('canvas');
    // Size the canvas to the screen track's native resolution so the recording is full quality.
    const screenSettings = screenStream.getVideoTracks()[0].getSettings();
    canvas.width = screenSettings.width ?? FALLBACK_WIDTH;
    canvas.height = screenSettings.height ?? FALLBACK_HEIGHT;

    const ctx = canvas.getContext('2d');
    // captureStream is unavailable in some test environments — bail out gracefully.
    if (!ctx || typeof canvas.captureStream !== 'function') {
      setOutputStream(null);
      return;
    }

    const screenVideo = createHiddenVideo(screenStream);
    const cameraVideo = createHiddenVideo(cameraStream);

    let rafId = 0;
    let lastDrawAt = -Infinity;
    const draw = (now: number) => {
      // Re-arm first so an early return still keeps the loop alive.
      rafId = requestAnimationFrame(draw);

      // Sub-millisecond tolerance: at 60Hz the 16.67ms callbacks would
      // otherwise alternate just under the 33.3ms gate and halve the output
      // to 20fps.
      if (now - lastDrawAt < FRAME_INTERVAL_MS - 1) return;
      lastDrawAt = now;

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);
      if (screenVideo.videoWidth > 0) {
        ctx.drawImage(screenVideo, 0, 0, w, h);
      }

      const g = geometryRef.current;
      const diameter = clamp(g.size, 0.05, 0.6) * h;
      const radius = diameter / 2;
      const cx = clamp(g.x, 0, 1) * w;
      const cy = clamp(g.y, 0, 1) * h;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      drawCover(ctx, cameraVideo, cx - radius, cy - radius, diameter, diameter, true);
      ctx.restore();

      // White ring around the bubble, matching the on-screen preview.
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, diameter * 0.025);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();
    };

    rafId = requestAnimationFrame(draw);

    const stream = canvas.captureStream(FRAME_RATE);
    setOutputStream(stream);

    return () => {
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      // Pause before dropping the source: clearing srcObject alone leaves the
      // element decoding until GC gets to it.
      screenVideo.pause();
      cameraVideo.pause();
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
      setOutputStream(null);
    };
  }, [enabled, screenStream, cameraStream, geometryRef]);

  return outputStream;
}
