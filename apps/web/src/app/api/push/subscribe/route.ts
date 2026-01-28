import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { pushSubscriptionSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

// POST /api/push/subscribe - Register a push subscription
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const { endpoint, keys, participantId } = pushSubscriptionSchema.parse(body);

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    if (!user && !participantId) {
      return errorResponse('Authentication required or participant ID must be provided', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('upsert_push_subscription', {
      p_endpoint: endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: request.headers.get('user-agent') ?? null,
      p_participant_id: participantId ?? null,
    });

    if (error) {
      console.error('Push subscribe error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
