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

// Billing plan. Free = P2P + 20 listeners, YouTube-only streaming.
// plus = $1/mo audience tier (up to 100 listeners). pro/team unlock all
// streaming platforms and larger rooms.
export type Plan = 'free' | 'plus' | 'pro' | 'team';

/**
 * Max concurrent listeners (read-only SFU subscribers) a room owner on each
 * plan may host. Single source of truth for the capacity gate; enforced at
 * session-create, the join_session RPC (via settings.maxParticipants), and the
 * LiveKit token mint. Always resolve against effectivePlan() so a lapsed paid
 * plan falls back to the free cap.
 */
export const LISTENER_CAP: Record<Plan, number> = {
  free: 20,
  plus: 100,
  pro: 500,
  team: 2000,
};

export function maxListeners(plan: Plan): number {
  return LISTENER_CAP[plan];
}

// Profile table
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null; // Unique public handle for /u/<username>
  bio: string | null; // Short public bio
  plan: Plan;
  plan_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileInsert {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  bio?: string | null;
  plan?: Plan;
  plan_expires_at?: string | null;
}

export interface ProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  bio?: string | null;
  plan?: Plan;
  plan_expires_at?: string | null;
  updated_at?: string;
}

// Public profile card (from get_public_profile RPC) — safe columns only
export interface PublicProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  public_room_count: number;
}

/**
 * The plan that's actually in effect right now. CoinPay is invoice-based, so a
 * paid plan only counts while its period (plan_expires_at) is still in the
 * future; otherwise it lapses back to free. Source of truth for every gate.
 */
export function effectivePlan(plan: Plan, planExpiresAt: string | null): Plan {
  if (plan === 'free') return 'free';
  if (!planExpiresAt) return 'free';
  return new Date(planExpiresAt).getTime() > Date.now() ? plan : 'free';
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
  is_public: boolean; // Listed in the public /live directory
  subject: string | null; // Public title shown in /live
  description: string | null; // Public description shown in /live
  banner_url: string | null; // 16:9 banner image shown on /live
  published_at: string | null; // When first made public
  host_last_seen_at: string | null; // Last heartbeat from current host
  expires_at: string | null; // Room TTL expiration
  created_at: string;
  ended_at: string | null;
}

// Public directory room (from list_public_rooms RPC) — safe columns only
export interface PublicRoom {
  id: string;
  join_code: string;
  subject: string | null;
  description: string | null;
  banner_url: string | null;
  mode: SessionMode;
  status: SessionStatus;
  is_live: boolean;
  viewer_count: number;
  published_at: string | null;
  created_at: string;
  host_username: string | null;
  host_display_name: string | null;
  host_avatar_url: string | null;
  channel_handle: string | null;
  channel_name: string | null;
}

// A creator's live (from list_creator_lives RPC) — their full public history.
export interface CreatorLive {
  id: string;
  join_code: string;
  subject: string | null;
  description: string | null;
  banner_url: string | null;
  status: SessionStatus;
  is_live: boolean;
  viewer_count: number;
  published_at: string | null;
  created_at: string;
}

// Follow state for a creator (from get_follow_state RPC).
export interface FollowState {
  follower_count: number;
  is_following: boolean;
}

// Account-to-account direct messages.

// One row in a DM conversation (from get_dm_conversation RPC).
export interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  is_mine: boolean;
}

// Public identity for the person at a DM address (from get_dm_partner RPC).
// A creator's identity is their channel (name + @handle); otherwise their profile.
export interface DmPartner {
  id: string;
  /** URL-safe address that always routes: channel handle, username, or id. */
  addr: string;
  display_name: string;
  avatar_url: string | null;
  username: string | null;
  /** The partner's channel handle, if they have one (links to /@handle). */
  channel_handle: string | null;
}

// One inbox row (from list_dm_threads RPC): a conversation partner + last message.
export interface DmThread {
  partner_id: string;
  /** URL-safe address that always routes: channel handle, username, or id. */
  addr: string;
  display_name: string;
  avatar_url: string | null;
  username: string | null;
  channel_handle: string | null;
  last_body: string;
  last_created_at: string;
  last_from_me: boolean;
  unread_count: number;
}

// Public detail for one live (from get_public_session RPC) — the /l/<code> page.
export interface PublicSessionDetail {
  id: string;
  join_code: string;
  subject: string | null;
  description: string | null;
  banner_url: string | null;
  status: SessionStatus;
  is_live: boolean;
  viewer_count: number;
  published_at: string | null;
  created_at: string;
  host_username: string | null;
  host_display_name: string | null;
  host_avatar_url: string | null;
  like_count: number;
  comment_count: number;
  liked: boolean;
  channel_handle: string | null;
  channel_name: string | null;
  /** Playback URL of the latest finished recording, when available. */
  recording_url: string | null;
}

// A finished server-side recording of a channel's past stream
// (from list_channel_recordings RPC) — powers "watch later" lists.
export interface ChannelRecording {
  id: string;
  join_code: string;
  subject: string | null;
  banner_url: string | null;
  playback_url: string;
  duration_seconds: number | null;
  created_at: string;
}

// A comment on a live (from list_comments RPC).
export interface SessionComment {
  id: string;
  body: string;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  is_mine: boolean;
}

// Public channel (from get_channel RPC) — the /c/<handle> page.
export interface Channel {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  subscriber_count: number;
  is_subscribed: boolean;
  is_owner: boolean;
  is_live: boolean;
  /** Guest-inclusive count of people watching the channel's live right now. */
  live_viewers: number;
  /** The channel owner's username; null if they have none. */
  owner_username: string | null;
  /** URL-safe address to DM the owner: username, else the owner's id. */
  owner_addr: string | null;
}

// A channel the caller owns (from list_my_channels RPC) — includes stream_key.
export interface MyChannel {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  stream_key: string;
  subscriber_count: number;
  /** Master switch: auto-restream this channel's lives to external RTMP. */
  restream_enabled: boolean;
  created_at: string;
}

// An external RTMP restream destination on a channel (from
// list_channel_restream_destinations). The secret stream_key is never returned.
export interface ChannelRestreamDestination {
  id: string;
  platform: string; // 'youtube' | 'twitch' | 'facebook' | 'custom'
  label: string | null;
  rtmp_url: string;
  enabled: boolean;
  has_key: boolean;
  created_at: string;
}

// A stream on a channel (from list_channel_streams RPC).
export interface ChannelStream {
  id: string;
  join_code: string;
  subject: string | null;
  description: string | null;
  banner_url: string | null;
  status: SessionStatus;
  is_live: boolean;
  viewer_count: number;
  published_at: string | null;
  created_at: string;
}

// A creator card (from list_creators RPC) — for the /live browse section.
export interface Creator {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  is_live: boolean;
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

// Plan payments table (CoinPay invoices for the multistream plugin).
// `status` is stored as a plain string; these are the values we set.
export type PlanPaymentStatus = 'pending' | 'confirmed' | 'forwarded' | 'expired' | 'failed';

export interface PlanPayment {
  id: string;
  coinpay_payment_id: string;
  user_id: string;
  plan: Exclude<Plan, 'free'>;
  amount_usd: number;
  currency: string;
  status: string;
  credited_at: string | null;
  tx_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PlanPaymentInsert {
  coinpay_payment_id: string;
  user_id: string;
  plan: Exclude<Plan, 'free'>;
  amount_usd: number;
  currency: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface PlanPaymentUpdate {
  status?: string;
  credited_at?: string | null;
  tx_hash?: string | null;
  metadata?: Record<string, unknown>;
  updated_at?: string;
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
      plan_payments: {
        Row: PlanPayment;
        Insert: PlanPaymentInsert;
        Update: PlanPaymentUpdate;
      };
    };
    Functions: {
      grant_plan: {
        Args: { p_user_id: string; p_plan: string; p_days: number };
        Returns: string;
      };
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
      // Public directory + usernames
      set_username: {
        Args: { p_username: string };
        Returns: Profile;
      };
      set_room_visibility: {
        Args: {
          p_session_id: string;
          p_is_public: boolean;
          p_subject?: string | null;
          p_description?: string | null;
        };
        Returns: Session;
      };
      list_public_rooms: {
        Args: { p_limit?: number; p_username?: string | null };
        Returns: PublicRoom[];
      };
      get_public_profile: {
        Args: { p_username: string };
        Returns: PublicProfile[];
      };
    };
  };
}
