/**
 * @pairux/shared-types
 *
 * Shared TypeScript type definitions for PairUX
 */

// Database types
export type {
  SessionStatus,
  SessionMode,
  MediaSessionStatus,
  ConnectionStatus,
  ParticipantRole,
  ControlState,
  SessionSettings,
  Plan,
  Profile,
  ProfileInsert,
  ProfileUpdate,
  PublicProfile,
  Session,
  SessionInsert,
  SessionUpdate,
  PublicRoom,
  CreatorLive,
  FollowState,
  DmMessage,
  DmThread,
  DmPartner,
  Creator,
  PublicSessionDetail,
  SessionComment,
  Channel,
  MyChannel,
  ChannelStream,
  ChannelRecording,
  ChannelRestreamDestination,
  SessionParticipant,
  SessionParticipantInsert,
  SessionParticipantUpdate,
  SessionWithParticipants,
  MessageType,
  ChatMessage,
  ChatMessageInsert,
  SessionWithMessages,
  MediaSession,
  MediaSessionInsert,
  MediaSessionUpdate,
  CaptureSourceInfo,
  SessionStatusResult,
  PlanPaymentStatus,
  PlanPayment,
  PlanPaymentInsert,
  PlanPaymentUpdate,
  Database,
} from './database.js';

// Database value exports (functions/helpers)
export { effectivePlan, maxListeners, LISTENER_CAP } from './database.js';

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
  KickMessage,
  MuteMessage,
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
