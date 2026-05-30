import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CameraBubble } from './CameraBubble';
import type { BubbleGeometry } from '@/hooks/useScreenCameraCompositor';

// jsdom lacks pointer capture APIs used during dragging.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

// jsdom does not implement PointerEvent, so synthetic pointer events drop clientX/Y.
// Dispatch a MouseEvent with the pointer type instead — it carries real coordinates.
function pointer(el: Element, type: string, clientX: number, clientY: number): void {
  fireEvent(el, new MouseEvent(type, { clientX, clientY, bubbles: true }));
}

const baseGeometry: BubbleGeometry = { x: 0.8, y: 0.8, size: 0.2 };

function renderBubble(overrides: Partial<Parameters<typeof CameraBubble>[0]> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <CameraBubble
      stream={null}
      containerWidth={1000}
      containerHeight={1000}
      videoWidth={1920}
      videoHeight={1080}
      geometry={baseGeometry}
      onChange={onChange}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onChange, onClose };
}

describe('CameraBubble', () => {
  it('renders a draggable self-view', () => {
    renderBubble();
    expect(screen.getByTestId('camera-bubble')).toBeInTheDocument();
  });

  it('reports a new position while dragging', () => {
    const { onChange } = renderBubble();
    const bubble = screen.getByTestId('camera-bubble');

    pointer(bubble, 'pointerdown', 800, 800);
    pointer(bubble, 'pointermove', 700, 700);

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as BubbleGeometry;
    // Dragging left/up should decrease x and y.
    expect(next.x).toBeLessThan(baseGeometry.x);
    expect(next.y).toBeLessThan(baseGeometry.y);
  });

  it('keeps the bubble within the picture bounds', () => {
    const { onChange } = renderBubble();
    const bubble = screen.getByTestId('camera-bubble');

    pointer(bubble, 'pointerdown', 800, 800);
    // Drag far past the right/bottom edge.
    pointer(bubble, 'pointermove', 5000, 5000);

    const next = onChange.mock.calls.at(-1)?.[0] as BubbleGeometry;
    expect(next.x).toBeLessThanOrEqual(1);
    expect(next.y).toBeLessThanOrEqual(1);
  });

  it('turns the camera off via the close button without starting a drag', () => {
    const { onClose, onChange } = renderBubble();
    fireEvent.click(screen.getByTestId('camera-bubble-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resizes on scroll', () => {
    const { onChange } = renderBubble();
    fireEvent.wheel(screen.getByTestId('camera-bubble'), { deltaY: -100 });
    const next = onChange.mock.calls.at(-1)?.[0] as BubbleGeometry;
    expect(next.size).toBeGreaterThan(baseGeometry.size);
  });
});
