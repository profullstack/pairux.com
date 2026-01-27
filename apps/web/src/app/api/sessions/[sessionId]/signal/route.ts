import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { z } from 'zod';

// Type for session (until Supabase types are regenerated)
interface Session {
  id: string;
  status: string;
  host_user_id: string | null;
}

// Signal message schema
const signalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  sdp: z.string().optional(),
  candidate: z
    .object({
      candidate: z.string(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    })
    .optional(),
  targetId: z.string().optional(),
  senderId: z.string(),
  timestamp: z.number(),
});

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // signals per minute (higher than chat - ICE candidates can be frequent)
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// POST /api/sessions/[sessionId]/signal - Send a signaling message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const signal = signalSchema.parse(body);

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    // Rate limit by sender ID
    const rateLimitKey = signal.senderId;
    if (!checkRateLimit(rateLimitKey)) {
      return errorResponse('Rate limit exceeded', 429);
    }

    // Verify session exists and is active
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status, host_user_id')
      .eq('id', sessionId)
      .single();

    const session = sessionData as Session | null;

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    if (session.status === 'ended') {
      return errorResponse('Session has ended', 410);
    }

    // Verify sender is a participant or the host
    const isHost = user?.id === session.host_user_id;

    if (!isHost) {
      // Check if sender is a participant
      const { data: participant } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', sessionId)
        .eq('id', signal.senderId)
        .is('left_at', null)
        .single();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!participant) {
        return errorResponse('Not authorized to send signals in this session', 403);
      }
    }

    // Broadcast the signal via Supabase Realtime
    // Create a server-side channel to broadcast
    const channel = supabase.channel(`session:${sessionId}`);

    // Subscribe and wait for confirmation
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (status === 'SUBSCRIBED') {
          resolve();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel subscription failed: ${status}`));
        }
      });
    });

    await channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: signal.type,
        sdp: signal.sdp,
        candidate: signal.candidate,
        senderId: signal.senderId,
        targetId: signal.targetId,
        timestamp: signal.timestamp,
      },
    });

    await supabase.removeChannel(channel);

    return successResponse({ sent: true }, 200);
  } catch (error) {
    return handleApiError(error);
  }
}
