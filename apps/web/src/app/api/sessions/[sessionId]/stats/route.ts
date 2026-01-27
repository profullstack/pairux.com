import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { z } from 'zod';

// Type for session (until Supabase types are regenerated)
interface Session {
  id: string;
  status?: string;
  host_user_id: string | null;
}

// Type for session_usage record (until Supabase types are regenerated)
interface SessionUsageRecord {
  id: string;
  session_id: string;
  participant_id: string;
  user_id: string | null;
  role: string;
  bytes_sent: number | null;
  bytes_received: number | null;
  packets_sent: number | null;
  packets_received: number | null;
  packets_lost: number | null;
  round_trip_time: number | null;
  jitter: number | null;
  frame_rate: number | null;
  frame_width: number | null;
  frame_height: number | null;
  connection_state: string;
  report_interval_ms: number;
  reported_at: string;
  created_at: string;
}

// Stats report schema - matches WebRTC getStats() output
const statsReportSchema = z.object({
  participantId: z.string(),
  role: z.enum(['host', 'viewer']),
  timestamp: z.number(),

  // Connection stats
  connectionState: z.enum(['connecting', 'connected', 'disconnected', 'failed', 'closed']),
  iceConnectionState: z.string().optional(),

  // Bandwidth stats (bytes)
  bytesSent: z.number().default(0),
  bytesReceived: z.number().default(0),

  // Packet stats
  packetsSent: z.number().default(0),
  packetsReceived: z.number().default(0),
  packetsLost: z.number().default(0),

  // Quality metrics
  roundTripTime: z.number().optional(), // ms
  jitter: z.number().optional(), // ms
  frameRate: z.number().optional(),
  frameWidth: z.number().optional(),
  frameHeight: z.number().optional(),

  // Duration since last report (ms)
  reportInterval: z.number().default(30000),
});

// Rate limit: 1 report per 10 seconds per participant
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const lastReport = rateLimitMap.get(key);

  if (lastReport && now - lastReport < RATE_LIMIT_MS) {
    return false;
  }

  rateLimitMap.set(key, now);
  return true;
}

// POST /api/sessions/[sessionId]/stats - Report usage statistics
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const stats = statsReportSchema.parse(body);

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    // Rate limit by participant ID
    const rateLimitKey = `${sessionId}:${stats.participantId}`;
    if (!checkRateLimit(rateLimitKey)) {
      return errorResponse('Rate limit exceeded - report less frequently', 429);
    }

    // Verify session exists
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status, host_user_id')
      .eq('id', sessionId)
      .single();

    const session = sessionData as Session | null;

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    // Verify participant
    const isHost = user?.id === session.host_user_id;

    if (!isHost) {
      const { data: participant } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', sessionId)
        .eq('id', stats.participantId)
        .is('left_at', null)
        .single();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!participant) {
        return errorResponse('Not authorized', 403);
      }
    }

    // Insert usage record
    // Use type assertion to bypass Supabase types until session_usage table is regenerated
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    const { error: insertError } = await (supabase as any).from('session_usage').insert({
      session_id: sessionId,
      participant_id: stats.participantId,
      user_id: user?.id ?? null,
      role: stats.role,
      bytes_sent: stats.bytesSent,
      bytes_received: stats.bytesReceived,
      packets_sent: stats.packetsSent,
      packets_received: stats.packetsReceived,
      packets_lost: stats.packetsLost,
      round_trip_time: stats.roundTripTime ?? null,
      jitter: stats.jitter ?? null,
      frame_rate: stats.frameRate ?? null,
      frame_width: stats.frameWidth ?? null,
      frame_height: stats.frameHeight ?? null,
      connection_state: stats.connectionState,
      report_interval_ms: stats.reportInterval,
      reported_at: new Date(stats.timestamp).toISOString(),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

    if (insertError) {
      console.error('Failed to insert usage stats:', insertError);
      // Don't fail the request - usage tracking shouldn't break the session
      // But log it for monitoring
    }

    return successResponse({ recorded: true }, 200);
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/sessions/[sessionId]/stats - Get aggregated usage for a session (host only)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    if (!user) {
      return errorResponse('Authentication required', 401);
    }

    // Verify user is the host
    const { data: sessionData2, error: sessionError } = await supabase
      .from('sessions')
      .select('id, host_user_id')
      .eq('id', sessionId)
      .single();

    const session = sessionData2 as Session | null;

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    if (session.host_user_id !== user.id) {
      return errorResponse('Only the host can view session stats', 403);
    }

    // Get aggregated stats
    // Use type assertion to bypass Supabase types until session_usage table is regenerated
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    const { data: statsData, error: statsError } = await (supabase as any)
      .from('session_usage')
      .select('*')
      .eq('session_id', sessionId)
      .order('reported_at', { ascending: false });
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

    const stats = statsData as SessionUsageRecord[] | null;

    if (statsError) {
      return errorResponse('Failed to fetch stats', 500);
    }

    // Aggregate by participant
    const byParticipant = new Map<
      string,
      {
        participantId: string;
        role: string;
        totalBytesSent: number;
        totalBytesReceived: number;
        reportCount: number;
        avgRoundTripTime: number | null;
        lastReportedAt: string;
      }
    >();

    for (const record of stats ?? []) {
      const existing = byParticipant.get(record.participant_id);
      if (existing) {
        existing.totalBytesSent += record.bytes_sent ?? 0;
        existing.totalBytesReceived += record.bytes_received ?? 0;
        existing.reportCount += 1;
        if (record.round_trip_time && existing.avgRoundTripTime) {
          existing.avgRoundTripTime =
            (existing.avgRoundTripTime * (existing.reportCount - 1) + record.round_trip_time) /
            existing.reportCount;
        }
      } else {
        byParticipant.set(record.participant_id, {
          participantId: record.participant_id,
          role: record.role,
          totalBytesSent: record.bytes_sent ?? 0,
          totalBytesReceived: record.bytes_received ?? 0,
          reportCount: 1,
          avgRoundTripTime: record.round_trip_time,
          lastReportedAt: record.reported_at,
        });
      }
    }

    // Calculate totals
    let totalBytesSent = 0;
    let totalBytesReceived = 0;

    for (const p of byParticipant.values()) {
      totalBytesSent += p.totalBytesSent;
      totalBytesReceived += p.totalBytesReceived;
    }

    return successResponse({
      sessionId,
      totalBytesSent,
      totalBytesReceived,
      totalBytesTransferred: totalBytesSent + totalBytesReceived,
      participants: Array.from(byParticipant.values()),
      reportCount: stats?.length ?? 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
