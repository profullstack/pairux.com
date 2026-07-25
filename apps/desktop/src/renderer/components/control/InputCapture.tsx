import { useRef, useEffect, type ReactNode } from 'react';
import type { InputEvent, ControlStateUI } from '@pairux/shared-types';
import { useRemoteControl } from '@/hooks/useRemoteControl';

interface InputCaptureProps {
  children: ReactNode;
  enabled: boolean;
  controlState: ControlStateUI;
  onInputEvent: (event: InputEvent) => void;
  onCursorMove?: ((x: number, y: number, visible: boolean) => void) | undefined;
  className?: string;
}

/**
 * Captures mouse and keyboard over the remote video and forwards it to the
 * host. Coordinates are normalized against this container, so the host maps
 * them onto its own screen regardless of how the video is scaled here.
 */
export function InputCapture({
  children,
  enabled,
  controlState,
  onInputEvent,
  onCursorMove,
  className = '',
}: InputCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { isCapturing, startCapture, stopCapture } = useRemoteControl({
    enabled,
    controlState,
    containerRef,
    onInputEvent,
    onCursorMove,
  });

  // Capture only while control is actually granted.
  useEffect(() => {
    if (controlState === 'granted' && enabled) {
      startCapture();
    } else if (controlState !== 'granted' && isCapturing) {
      stopCapture();
    }
  }, [controlState, enabled, isCapturing, startCapture, stopCapture]);

  // Keyboard events need focus on the container.
  useEffect(() => {
    if (isCapturing && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isCapturing]);

  return (
    <div
      ref={containerRef}
      tabIndex={enabled ? 0 : -1}
      className={`relative outline-none ${className} ${
        controlState === 'granted' ? 'cursor-none' : ''
      }`}
      style={{
        userSelect: isCapturing ? 'none' : 'auto',
      }}
    >
      {children}

      {controlState === 'granted' && (
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-green-500/50" />
      )}
    </div>
  );
}
