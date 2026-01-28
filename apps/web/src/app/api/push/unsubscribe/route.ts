import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { z } from 'zod';

const unsubscribeSchema = z.object({
  endpoint: z.string().url('Invalid endpoint URL'),
});

// POST /api/push/unsubscribe - Remove a push subscription
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const { endpoint } = unsubscribeSchema.parse(body);

    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('remove_push_subscription', {
      p_endpoint: endpoint,
    });

    if (error) {
      console.error('Push unsubscribe error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return successResponse({ removed: data });
  } catch (error) {
    return handleApiError(error);
  }
}
