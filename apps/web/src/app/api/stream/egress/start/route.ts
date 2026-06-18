import { EncodingOptions, StreamOutput, StreamProtocol } from 'livekit-server-sdk';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getEgressClient } from '@/lib/livekit-egress';
import type { Database, Session } from '@pairux/shared-types';

/**
 * Start server-side RTMP restreaming for a session.
 *
 * The host uploads once (their WebRTC publish to the SFU); the egress service
 * composites the room on the server and fans out to every RTMP destination.
 * Available on all plans — no gating.
 */

const MAX_DESTINATIONS = 4;

interface StartEgressBody {
  sessionId: string;
  /** Full RTMP(S) ingest URLs including stream keys. Never persisted. */
  rtmpUrls: string[];
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase service role configuration');
  }
  return createSupabaseAdminClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as Partial<StartEgressBody>;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const rtmpUrls = Array.isArray(body.rtmpUrls) ? body.rtmpUrls : [];

    if (!sessionId) {
      return errorResponse('sessionId is required', 400);
    }
    if (rtmpUrls.length === 0 || rtmpUrls.length > MAX_DESTINATIONS) {
      return errorResponse(`Provide 1-${String(MAX_DESTINATIONS)} RTMP destination URLs`, 400);
    }
    if (!rtmpUrls.every((u) => typeof u === 'string' && /^rtmps?:\/\/.+/.test(u))) {
      return errorResponse('Destinations must be rtmp:// or rtmps:// URLs', 400);
    }

    // Only the session's creator or active host may broadcast it.
    const admin = getSupabaseAdmin();
    const { data: session, error } = await admin
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single<Session>();
    // .single() errors when no row matches, so data is non-null past here.
    if (error) {
      return errorResponse('Session not found', 404);
    }
    const isHost =
      session.creator_id === user.id ||
      session.current_host_id === user.id ||
      session.host_user_id === user.id;
    if (!isHost) {
      return errorResponse('Only the session host can start a live stream', 403);
    }

    const egress = getEgressClient();
    if (!egress) {
      return errorResponse('Server-side streaming is not configured', 503);
    }

    const roomName = `session-${sessionId}`;
    const info = await egress.startRoomCompositeEgress(
      roomName,
      { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: rtmpUrls }) },
      {
        layout: 'speaker',
        // Explicit 1080p30 with a 1-second keyframe interval. The preset
        // defaults to 4s; YouTube Live then sits on "Preparing stream" with
        // good health and intermittently never goes live, while Twitch (more
        // lenient) always does. 2s helped but YouTube was still flaky; 1s
        // (a keyframe every 30 frames) makes YouTube leave "Preparing"
        // reliably and is well within its <=4s requirement.
        encodingOptions: new EncodingOptions({
          width: 1920,
          height: 1080,
          framerate: 30,
          videoBitrate: 4500,
          audioBitrate: 128,
          keyFrameInterval: 1,
        }),
      }
    );

    return successResponse({ egressId: info.egressId });
  } catch (error) {
    return handleApiError(error);
  }
}
