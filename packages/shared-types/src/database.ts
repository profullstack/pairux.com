/**
 * Database types for Supabase tables
 */

// Session status enum
export type SessionStatus = 'created' | 'active' | 'paused' | 'ended';

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

// Session table
export interface Session {
  id: string;
  host_user_id: string;
  status: SessionStatus;
  join_code: string;
  settings: SessionSettings;
  created_at: string;
  ended_at: string | null;
}

export interface SessionInsert {
  host_user_id: string;
  status?: SessionStatus;
  settings?: SessionSettings;
}

export interface SessionUpdate {
  status?: SessionStatus;
  settings?: SessionSettings;
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
  control_state?: ControlState;
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
}

export interface ChatMessageInsert {
  session_id: string;
  user_id?: string | null;
  display_name: string;
  content: string;
  message_type?: MessageType;
}

// Session with messages (joined query)
export interface SessionWithMessages extends Session {
  chat_messages: ChatMessage[];
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
      send_chat_message: {
        Args: {
          p_session_id: string;
          p_content: string;
          p_participant_id?: string;
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
    };
  };
}
