import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { z } from 'zod';

// Query params schema
const querySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  limit: z.coerce.number().min(1).max(100).default(100),
  before: z.string().datetime().optional(),
  recipientId: z.string().uuid().optional(), // For DM threads - filter to messages with this recipient
});

// GET /api/chat/history - Get chat history for a session
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      sessionId: searchParams.get('sessionId'),
      limit: searchParams.get('limit') ?? 100,
      before: searchParams.get('before') ?? undefined,
      recipientId: searchParams.get('recipientId') ?? undefined,
    });

    const supabase = await createClient();

    // Check authentication (for RLS policies)
    const { user } = await getAuthenticatedUser(supabase);

    // Build query
    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', params.sessionId)
      .order('created_at', { ascending: false })
      .limit(params.limit);

    // Filter for DM threads
    if (params.recipientId && user) {
      // Get messages between current user and recipient
      // This includes messages where:
      // - Current user sent to recipient, OR
      // - Recipient sent to current user
      query = query.or(
        `and(user_id.eq.${user.id},recipient_id.eq.${params.recipientId}),and(user_id.eq.${params.recipientId},recipient_id.eq.${user.id})`
      );
    } else if (!params.recipientId) {
      // For public chat, only show messages without a recipient
      query = query.is('recipient_id', null);
    }

    // Pagination: get messages before a certain timestamp
    if (params.before) {
      query = query.lt('created_at', params.before);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Get chat history error:', error);

      // Check if it's an RLS violation (user not in session)
      if (error.code === 'PGRST301' || error.message.includes('permission')) {
        return errorResponse('Access denied - you are not a participant in this session', 403);
      }

      return errorResponse(error.message, 400);
    }

    // data is guaranteed non-null after error check
    const messageData = data;

    // If no user and no data, they likely don't have access
    if (!user && messageData.length === 0) {
      // Check if session exists first
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', params.sessionId)
        .single();

      if (sessionError) {
        return errorResponse('Session not found', 404);
      }

      // Session variable used to confirm access
      void session;
    }

    // Reverse to get chronological order (oldest first)
    const messages = messageData.reverse();

    return successResponse({
      messages,
      hasMore: messageData.length === params.limit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
