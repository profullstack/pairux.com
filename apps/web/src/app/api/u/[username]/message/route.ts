/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { notifyDirectMessage } from '@/lib/notify-dm';

interface RouteParams {
  params: Promise<{ username: string }>;
}

interface SendBody {
  body?: unknown;
}

// POST /api/u/[username]/message — send a direct message to a user by username.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Sign in to send a message', 401);
    }

    const json = (await request.json().catch(() => ({}))) as SendBody;
    const body = typeof json.body === 'string' ? json.body.trim() : '';
    if (!body) return errorResponse('Message cannot be empty', 400);
    if (body.length > 4000) return errorResponse('Message is too long', 400);

    const { data, error } = await (supabase.rpc as any)('send_direct_message', {
      p_username: username,
      p_body: body,
    });
    if (error) {
      return errorResponse(error.message ?? 'Failed to send message', 400);
    }

    const row = (data as { message_id: string; recipient_id: string }[] | null)?.[0];
    if (!row) return errorResponse('Failed to send message', 400);

    // Fire-and-forget push + email to the recipient.
    void notifyDirectMessage({
      recipientId: row.recipient_id,
      senderId: user.id,
      body,
    });

    return successResponse({ message_id: row.message_id });
  } catch (error) {
    return handleApiError(error);
  }
}
