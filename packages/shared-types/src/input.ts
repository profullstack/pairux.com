/**
 * Input event types for remote control
 */

// Mouse move event
export interface MouseMoveEvent {
  type: 'mouse';
  action: 'move';
  x: number; // 0-1 relative to screen
  y: number; // 0-1 relative to screen
}

// Mouse button type
export type MouseButton = 'left' | 'right' | 'middle';

// Mouse button event
export interface MouseButtonEvent {
  type: 'mouse';
  action: 'down' | 'up' | 'click' | 'dblclick';
  button: MouseButton;
  x: number;
  y: number;
}

// Mouse scroll event
export interface MouseScrollEvent {
  type: 'mouse';
  action: 'scroll';
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
}

// All mouse events union
export type MouseEvent = MouseMoveEvent | MouseButtonEvent | MouseScrollEvent;

// Keyboard modifiers
export interface KeyboardModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean; // Cmd on macOS, Win on Windows
}

// Keyboard event
export interface KeyboardEvent {
  type: 'keyboard';
  action: 'down' | 'up' | 'press';
  key: string; // e.g., 'a', 'Enter', 'Escape'
  code: string; // e.g., 'KeyA', 'Enter', 'Escape'
  modifiers: KeyboardModifiers;
}

// Union type for all input events
export type InputEvent = MouseEvent | KeyboardEvent;

// Input message wrapper (sent over data channel)
export interface InputMessage {
  type: 'input';
  timestamp: number;
  sequence: number; // For ordering
  event: InputEvent;
}

// Control state (matches database type but used in UI)
export type ControlStateUI = 'view-only' | 'requested' | 'granted';

// Control transition triggers
export type ControlTransitionTrigger =
  | 'REQUEST_CONTROL'
  | 'DENY_REQUEST'
  | 'REQUEST_TIMEOUT'
  | 'APPROVE_REQUEST'
  | 'REVOKE_CONTROL'
  | 'RELEASE_CONTROL'
  | 'EMERGENCY_REVOKE'
  | 'VIEWER_DISCONNECT';

// Screen capture source
export interface CaptureSource {
  id: string;
  name: string;
  thumbnail?: string;
  type: 'screen' | 'window';
  displayId?: string;
}

// Capture settings
export interface CaptureSettings {
  resolution: 'native' | '1080p' | '720p';
  frameRate: 15 | 30 | 60;
  includeCursor: boolean;
  includeAudio: boolean;
}

// Quality preset
export interface QualityPreset {
  name: 'low' | 'medium' | 'high' | 'ultra';
  bitrate: number;
  resolution: number; // Scale factor (1.0 = native)
  frameRate: number;
}

// Default quality presets
export const QUALITY_PRESETS: Record<QualityPreset['name'], QualityPreset> = {
  low: { name: 'low', bitrate: 1_000_000, resolution: 0.5, frameRate: 15 },
  medium: { name: 'medium', bitrate: 2_500_000, resolution: 0.75, frameRate: 30 },
  high: { name: 'high', bitrate: 4_000_000, resolution: 1.0, frameRate: 30 },
  ultra: { name: 'ultra', bitrate: 8_000_000, resolution: 1.0, frameRate: 60 },
};
