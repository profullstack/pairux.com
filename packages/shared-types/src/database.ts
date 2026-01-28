/**
 * Database types for Supabase tables
 */

// Session status enum
export type SessionStatus = 'created' | 'active' | 'paused' | 'ended';

// Session mode (P2P = free, SFU = pro/team)
export type SessionMode = 'p2p' | 'sfu';

// Media session status
export type MediaSessionStatus = 'active' | 'paused' | 'ended';

// Connection status for presence
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

// Participant roles
export type ParticipantRole = 'host' | 'viewer';

// Control states
export type ControlState = 'view-only' | 'requested' | 'granted';

// Session settings
export interface SessionSettings {
  quality?: 'low' | 'medium' | 'high';
  allowControl?: boolean;
  maxParticipants?: number;
}

// Profile table
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileInsert {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface ProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
  updated_at?: string;
}

// Session table (Room-centric: room survives host disconnection)
export interface Session {
  id: string;
  host_user_id: string; // DEPRECATED: Use creator_id for owner, current_host_id for active host
  creator_id: string | null; // Who created the room (for billing/ownership)
  current_host_id: string | null; // Currently active host (nullable - room survives without host)
  status: SessionStatus;
  mode: SessionMode;
  join_code: string;
  settings: SessionSettings;
  host_last_seen_at: string | null; // Last heartbeat from current host
  expires_at: string | null; // Room TTL expiration
  created_at: string;
  ended_at: string | null;
}

export interface SessionInsert {
  host_user_id: string;
  status?: SessionStatus;
  mode?: SessionMode;
  settings?: SessionSettings;
}

export interface SessionUpdate {
  status?: SessionStatus;
  mode?: SessionMode;
  settings?: SessionSettings;
  current_host_id?: string | null;
  host_last_seen_at?: string | null;
  expires_at?: string | null;
  ended_at?: string | null;
}

// Session participant table
export interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  role: ParticipantRole;
  control_state: ControlState;
  is_backup_host: boolean;
  connection_status: ConnectionStatus;
  last_seen_at: string | null;
  joined_at: string;
  left_at: string | null;
}

export interface SessionParticipantInsert {
  session_id: string;
  user_id?: string | null;
  display_name: string;
  role?: ParticipantRole;
  control_state?: ControlState;
}

export interface SessionParticipantUpdate {
  display_name?: string;
  role?: ParticipantRole;
  control_state?: ControlState;
  is_backup_host?: boolean;
  connection_status?: ConnectionStatus;
  last_seen_at?: string | null;
  left_at?: string | null;
}

// Session with participants (joined query)
export interface SessionWithParticipants extends Session {
  session_participants: SessionParticipant[];
}

// Message types
export type MessageType = 'text' | 'system';

// Chat message table
export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  content: string;
  message_type: MessageType;
  created_at: string;
  recipient_id: string | null; // For DMs - when set, message is only visible to sender and recipient
}

export interface ChatMessageInsert {
  session_id: string;
  user_id?: string | null;
  display_name: string;
  content: string;
  message_type?: MessageType;
  recipient_id?: string | null;
}

// Session with messages (joined query)
export interface SessionWithMessages extends Session {
  chat_messages: ChatMessage[];
}

// Media session table (ephemeral screen shares within a room)
export interface MediaSession {
  id: string;
  room_id: string;
  publisher_id: string;
  mode: SessionMode;
  status: MediaSessionStatus;
  sfu_endpoint: string | null;
  sfu_room_id: string | null;
  capture_source: CaptureSourceInfo | null;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
}

export interface CaptureSourceInfo {
  type: 'screen' | 'window';
  name: string;
  id: string;
}

export interface MediaSessionInsert {
  room_id: string;
  publisher_id: string;
  mode?: SessionMode;
  capture_source?: CaptureSourceInfo;
}

export interface MediaSessionUpdate {
  status?: MediaSessionStatus;
  sfu_endpoint?: string | null;
  sfu_room_id?: string | null;
  paused_at?: string | null;
  ended_at?: string | null;
}

// Session status result from get_session_status RPC
export interface SessionStatusResult {
  session_id: string;
  status: SessionStatus;
  mode: SessionMode;
  host_online: boolean;
  host_last_seen: string | null;
  current_host_name: string | null;
  participant_count: number;
  has_active_media: boolean;
}

// Push subscription table
export interface PushSubscription {
  id: string;
  user_id: string | null;
  participant_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionInsert {
  user_id?: string | null;
  participant_id?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
}

// Database schema type for Supabase client
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      sessions: {
        Row: Session;
        Insert: SessionInsert;
        Update: SessionUpdate;
      };
      session_participants: {
        Row: SessionParticipant;
        Insert: SessionParticipantInsert;
        Update: SessionParticipantUpdate;
      };
      chat_messages: {
        Row: ChatMessage;
        Insert: ChatMessageInsert;
        Update: never; // Messages are immutable
      };
      media_sessions: {
        Row: MediaSession;
        Insert: MediaSessionInsert;
        Update: MediaSessionUpdate;
      };
      push_subscriptions: {
        Row: PushSubscription;
        Insert: PushSubscriptionInsert;
        Update: never;
      };
    };
    Functions: {
      create_session: {
        Args: { p_settings?: SessionSettings };
        Returns: Session;
      };
      join_session: {
        Args: { p_join_code: string; p_display_name?: string };
        Returns: SessionParticipant;
      };
      end_session: {
        Args: { p_session_id: string };
        Returns: Session;
      };
      update_control_state: {
        Args: {
          p_session_id: string;
          p_participant_id: string;
          p_control_state: ControlState;
        };
        Returns: SessionParticipant;
      };
      request_control: {
        Args: { p_session_id: string };
        Returns: SessionParticipant;
      };
      leave_session: {
        Args: { p_session_id: string };
        Returns: SessionParticipant;
      };
      kick_participant: {
        Args: { p_session_id: string; p_participant_id: string };
        Returns: SessionParticipant;
      };
      send_chat_message: {
        Args: {
          p_session_id: string;
          p_content: string;
          p_participant_id?: string;
          p_recipient_id?: string;
        };
        Returns: ChatMessage;
      };
      send_system_message: {
        Args: {
          p_session_id: string;
          p_content: string;
          p_display_name?: string;
        };
        Returns: ChatMessage;
      };
      // Room-centric functions
      update_host_presence: {
        Args: { p_session_id: string };
        Returns: Session;
      };
      update_participant_presence: {
        Args: { p_session_id: string };
        Returns: SessionParticipant;
      };
      start_media_session: {
        Args: {
          p_room_id: string;
          p_mode?: SessionMode;
          p_capture_source?: CaptureSourceInfo;
        };
        Returns: MediaSession;
      };
      pause_media_session: {
        Args: { p_media_session_id: string };
        Returns: MediaSession;
      };
      end_media_session: {
        Args: { p_media_session_id: string };
        Returns: MediaSession;
      };
      transfer_host: {
        Args: {
          p_session_id: string;
          p_new_host_participant_id: string;
        };
        Returns: Session;
      };
      set_backup_host: {
        Args: {
          p_session_id: string;
          p_participant_id: string;
          p_is_backup?: boolean;
        };
        Returns: SessionParticipant;
      };
      auto_promote_backup_host: {
        Args: { p_session_id: string };
        Returns: Session;
      };
      get_session_status: {
        Args: { p_session_id: string };
        Returns: SessionStatusResult;
      };
      set_room_expiration: {
        Args: {
          p_session_id: string;
          p_hours?: number;
        };
        Returns: Session;
      };
      cleanup_expired_rooms: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_stale_participants: {
        Args: Record<string, never>;
        Returns: number;
      };
      upsert_push_subscription: {
        Args: {
          p_endpoint: string;
          p_p256dh: string;
          p_auth: string;
          p_user_agent?: string;
          p_participant_id?: string;
        };
        Returns: PushSubscription;
      };
      remove_push_subscription: {
        Args: { p_endpoint: string };
        Returns: boolean;
      };
    };
  };
}
