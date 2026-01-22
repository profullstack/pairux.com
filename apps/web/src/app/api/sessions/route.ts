/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions */
import { createClient } from '@/lib/supabase/server';
import { createSessionSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

// POST /api/sessions - Create a new session
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const settings = createSessionSchema.parse(body);

    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Create session using RPC function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('create_session', {
      p_settings: {
        quality: 'medium',
        allowControl: settings.allowGuestControl,
        maxParticipants: settings.maxParticipants,
      },
    });

    if (error) {
      console.error('Create session error:', error);
      return errorResponse(error.message, 400);
    }

    return successResponse(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/sessions - List user's sessions
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Get user's sessions (as host)
    const { data, error } = await supabase
      .from('sessions')
      .select('*, session_participants(*)')
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('List sessions error:', error);
      return errorResponse(error.message, 400);
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}
