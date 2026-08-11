/**
 * WebRTC signaling message types
 */

// ICE Candidate init (compatible with WebRTC standard)
export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

// Base signaling message
export interface BaseSignalMessage {
  senderId: string;
  timestamp: number;
}

// SDP Offer message
export interface OfferMessage extends BaseSignalMessage {
  type: 'offer';
  sdp: string;
}

// SDP Answer message
export interface AnswerMessage extends BaseSignalMessage {
  type: 'answer';
  sdp: string;
}

// ICE Candidate message
export interface IceCandidateMessage extends BaseSignalMessage {
  type: 'ice-candidate';
  candidate: IceCandidateInit;
}

// Union type for all signal messages
export type SignalMessage = OfferMessage | AnswerMessage | IceCandidateMessage;

// Control request message
export interface ControlRequestMessage {
  type: 'control-request';
  participantId: string;
  timestamp: number;
}

// Control grant message
export interface ControlGrantMessage {
  type: 'control-grant';
  participantId: string;
  timestamp: number;
}

// Control revoke message
export interface ControlRevokeMessage {
  type: 'control-revoke';
  participantId: string;
  timestamp: number;
}

// Kick message (host kicks a participant)
export interface KickMessage {
  type: 'kick';
  reason?: string;
  timestamp: number;
}

// Mute message (host force-mutes/unmutes a participant)
export interface MuteMessage {
  type: 'mute';
  participantId: string;
  muted: boolean;
  timestamp: number;
}

/**
 * Peers telling each other their tailnet addresses.
 *
 * Diagnostic only: it establishes whether a direct WireGuard path between two
 * machines exists, which is the precondition for ever carrying media over the
 * tailnet instead of the SFU. Nothing routes differently because of it.
 *
 * Only native clients can answer — a browser has no way to learn its own
 * tailnet address.
 */
export interface TailnetHelloMessage {
  type: 'tailnet-hello';
  participantId: string;
  /** Tailnet addresses of the sender, empty when not on a tailnet. */
  ips: string[];
  /** True when replying to another peer's hello, to stop it ping-ponging. */
  reply: boolean;
  timestamp: number;
}

// Union type for control messages
export type ControlMessage =
  | ControlRequestMessage
  | ControlGrantMessage
  | ControlRevokeMessage
  | KickMessage
  | MuteMessage
  | TailnetHelloMessage;

// Ping/pong for latency measurement
export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
  originalTimestamp: number;
}

// Connection state
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnected';

// Quality metrics
export interface QualityMetrics {
  bitrate: number;
  frameRate: number;
  packetLoss: number;
  roundTripTime: number;
}

// Network quality level
export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'bad';

// Presence state for realtime channel
export interface PresenceState {
  id: string;
  displayName: string;
  role: 'host' | 'viewer';
  online_at: string;
}
