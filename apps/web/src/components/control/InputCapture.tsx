'use client';

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

  // Auto-start capture when control is granted
  useEffect(() => {
    if (controlState === 'granted' && enabled) {
      startCapture();
    } else if (controlState !== 'granted' && isCapturing) {
      stopCapture();
    }
  }, [controlState, enabled, isCapturing, startCapture, stopCapture]);

  // Focus container when capturing starts
  useEffect(() => {
    if (isCapturing && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isCapturing]);

  return (
    <div
      ref={containerRef}
      tabIndex={enabled ? 0 : -1}
      className={`outline-none ${className} ${controlState === 'granted' ? 'cursor-none' : ''}`}
      style={{
        // Prevent text selection while capturing
        userSelect: isCapturing ? 'none' : 'auto',
        WebkitUserSelect: isCapturing ? 'none' : 'auto',
      }}
    >
      {children}

      {/* Visual indicator when in control */}
      {controlState === 'granted' && (
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-green-500/50" />
      )}
    </div>
  );
}
