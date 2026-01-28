import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { sendChatMessageSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

// Simple in-memory rate limiter (for MVP - use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // messages per minute
const RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

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

// POST /api/chat/send - Send a chat message
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const { sessionId, content, participantId, recipientId } = sendChatMessageSchema.parse(body);

    const supabase = await createClient();

    // Check authentication (optional for guests with participantId)
    const { user } = await getAuthenticatedUser(supabase);

    // Rate limit by user ID or participant ID
    const rateLimitKey = user?.id ?? participantId ?? 'anonymous';
    if (!checkRateLimit(rateLimitKey)) {
      return errorResponse('Rate limit exceeded. Please wait before sending more messages.', 429);
    }

    // Guests must provide participantId, authenticated users don't need it
    if (!user && !participantId) {
      return errorResponse('Authentication required or participant ID must be provided', 401);
    }

    // Send message using RPC function
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('send_chat_message', {
      p_session_id: sessionId,
      p_content: content,
      p_participant_id: participantId ?? null,
      p_recipient_id: recipientId ?? null,
    });

    if (error) {
      console.error('Send chat message error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // Fire push notification to other participants (non-blocking)
    if (data && !recipientId) {
      const senderName = (data as { display_name?: string }).display_name ?? 'Someone';
      void import('@/lib/push').then(({ sendPushToSession }) => {
        void sendPushToSession(
          sessionId,
          'chatMessage',
          {
            title: 'New Message',
            body: `${senderName}: ${content.substring(0, 100)}`,
            url: `/session/${sessionId}`,
            tag: `chat-${sessionId}`,
          },
          user?.id ? [user.id] : [],
          participantId ? [participantId] : []
        );
      });
    }

    return successResponse(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
