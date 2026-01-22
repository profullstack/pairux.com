/**
 * @pairux/shared-types
 *
 * Shared TypeScript type definitions for PairUX
 */

// Database types
export type {
  SessionStatus,
  ParticipantRole,
  ControlState,
  SessionSettings,
  Profile,
  ProfileInsert,
  ProfileUpdate,
  Session,
  SessionInsert,
  SessionUpdate,
  SessionParticipant,
  SessionParticipantInsert,
  SessionParticipantUpdate,
  SessionWithParticipants,
  Database,
} from './database.js';

// Signaling types
export type {
  IceCandidateInit,
  BaseSignalMessage,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  SignalMessage,
  ControlRequestMessage,
  ControlGrantMessage,
  ControlRevokeMessage,
  ControlMessage,
  CursorPositionMessage,
  PingMessage,
  PongMessage,
  ConnectionState,
  QualityMetrics,
  NetworkQuality,
  PresenceState,
} from './signaling.js';

// Input types
export type {
  MouseMoveEvent,
  MouseButton,
  MouseButtonEvent,
  MouseScrollEvent,
  MouseEvent,
  KeyboardModifiers,
  KeyboardEvent,
  InputEvent,
  InputMessage,
  ControlStateUI,
  ControlTransitionTrigger,
  CaptureSource,
  CaptureSettings,
  QualityPreset,
} from './input.js';

export { QUALITY_PRESETS } from './input.js';
