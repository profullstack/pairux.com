/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { notifyDirectMessage } from '@/lib/notify-dm';
import type { DmMessage } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ username: string }>;
}

interface SendBody {
  body?: unknown;
}

// GET /api/messages/[username] — full conversation with a user (marks read).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Sign in to view messages', 401);
    }

    const { data, error } = await (supabase.rpc as any)('get_dm_conversation', {
      p_username: username,
      p_limit: 200,
    });
    if (error) {
      return errorResponse(error.message ?? 'Failed to load conversation', 400);
    }

    return successResponse({ messages: (data as DmMessage[] | null) ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/messages/[username] — reply within a conversation.
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
