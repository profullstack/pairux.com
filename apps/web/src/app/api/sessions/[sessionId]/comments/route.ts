/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { SessionComment } from '@pairux/shared-types';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET — list comments for a session (anon-readable via the RPC)
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();
    const { data, error } = await (supabase.rpc as any)('list_comments', {
      p_session_id: sessionId,
      p_limit: 200,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ comments: (data as SessionComment[] | null) ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}

const Body = z.object({ body: z.string().trim().min(1).max(1000) });

// POST — add a comment
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const { body } = Body.parse(await request.json());

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to comment', 401);

    const { data: id, error } = await (supabase.rpc as any)('add_comment', {
      p_session_id: sessionId,
      p_body: body,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ id }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
