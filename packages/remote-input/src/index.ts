/**
 * @profullstack/remote-input
 *
 * Cross-platform OS input injection for remote control: one normalized event
 * shape in, real cursor movement and keystrokes out, on macOS, Windows,
 * Linux/X11 and Linux/Wayland.
 */

export { RemoteInputInjector, type RemoteInputInjectorOptions } from './injector.js';

export {
  createInputBackend,
  getInputBackendSelection,
  selectInputBackend,
  type InputBackendKind,
  type InputBackendSelection,
} from './factory.js';

export { detectDisplayServer, detectPlatform, requiresAccessibilityPermission } from './platform.js';

export {
  BLOCKED_COMBINATIONS,
  InputRateLimiter,
  isDangerousCombination,
  validateInputEvent,
  type RejectionReason,
  type ValidationResult,
} from './safety.js';

export { NutJsInputBackend } from './backends/nutjs.js';
export { WaylandPortalInputBackend } from './backends/waylandPortal.js';
export { WaylandYdotoolInputBackend } from './backends/waylandYdotool.js';
export { UnsupportedWaylandInputBackend } from './backends/unsupportedWayland.js';

export type {
  DisplayServer,
  InputBackend,
  InputBackendInitResult,
  InputDiagnostics,
  InputEvent,
  InputStats,
  KeyboardInputEvent,
  KeyboardModifiers,
  MouseButton,
  MouseButtonEvent,
  MouseInputEvent,
  MouseMoveEvent,
  MouseScrollEvent,
  Platform,
} from './types.js';
