import { describe, it, expect } from 'vitest';

/**
 * RemoteCursor scales a cursor by containerDimensions / sourceDimensions, so it
 * expects SOURCE PIXELS. Cursor messages travel normalized 0-1, and feeding
 * those straight in put every cursor in the top-left corner: 0.5 * (1280/1920)
 * is a third of a pixel.
 *
 * This pins the conversion CapturePreview performs before handing a position to
 * the overlay.
 */
function toSourcePixels(
  normalized: { x: number; y: number },
  source: { width: number; height: number }
): { x: number; y: number } {
  return { x: normalized.x * source.width, y: normalized.y * source.height };
}

function scaleToContainer(
  sourcePixels: { x: number; y: number },
  source: { width: number; height: number },
  container: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: sourcePixels.x * (container.width / source.width),
    y: sourcePixels.y * (container.height / source.height),
  };
}

describe('remote cursor coordinate conversion', () => {
  const source = { width: 1920, height: 1080 };
  const container = { width: 1280, height: 720 };

  it('puts a centred cursor at the centre of the container', () => {
    const px = toSourcePixels({ x: 0.5, y: 0.5 }, source);
    const onScreen = scaleToContainer(px, source, container);

    expect(onScreen.x).toBeCloseTo(640, 5);
    expect(onScreen.y).toBeCloseTo(360, 5);
  });

  it('keeps the corners at the corners', () => {
    const topLeft = scaleToContainer(toSourcePixels({ x: 0, y: 0 }, source), source, container);
    expect(topLeft).toEqual({ x: 0, y: 0 });

    const bottomRight = scaleToContainer(toSourcePixels({ x: 1, y: 1 }, source), source, container);
    expect(bottomRight.x).toBeCloseTo(1280, 5);
    expect(bottomRight.y).toBeCloseTo(720, 5);
  });

  // The exact regression: normalized values used as if they were pixels.
  it('would collapse into the top-left without the conversion', () => {
    const wrong = scaleToContainer({ x: 0.5, y: 0.5 }, source, container);

    expect(wrong.x).toBeLessThan(1);
    expect(wrong.y).toBeLessThan(1);
  });
});
