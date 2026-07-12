/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { MyChannel } from '@pairux/shared-types';

// GET /api/channels — the caller's own channels (with stream keys)
export async function GET() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const { data, error } = await (supabase.rpc as any)('list_my_channels');
    if (error) return errorResponse(error.message, 400);
    return successResponse({ channels: (data as MyChannel[] | null) ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}

const CreateBody = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,30}$/, 'Handle must be 3-30 letters, numbers, or underscores'),
  name: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
});

// POST /api/channels — create a channel
export async function POST(request: Request) {
  try {
    const { handle, name, description } = CreateBody.parse(await request.json());
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to create a channel', 401);

    const { data: id, error } = await (supabase.rpc as any)('create_channel', {
      p_handle: handle,
      p_name: name ?? handle,
      p_description: description ?? null,
    });
    if (error) return errorResponse(error.message, 400);
    return successResponse({ id, handle }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
