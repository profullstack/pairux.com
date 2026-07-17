/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { DmThread } from '@pairux/shared-types';

// GET /api/messages — the caller's DM inbox (one row per conversation partner).
export async function GET() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Sign in to view messages', 401);
    }

    const { data, error } = await (supabase.rpc as any)('list_dm_threads');
    if (error) {
      return errorResponse(error.message ?? 'Failed to load messages', 400);
    }

    return successResponse({ threads: (data as DmThread[] | null) ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}
