import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { createSessionSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

// POST /api/sessions - Create a new session
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const settings = createSessionSchema.parse(body);

    const supabase = await createClient();

    // Check authentication (supports both cookie and Bearer token)
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Create session using RPC function
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('create_session', {
      p_settings: {
        quality: 'medium',
        allowControl: settings.allowGuestControl,
        maxParticipants: settings.maxParticipants,
      },
      p_mode: settings.mode,
    });

    if (error) {
      console.error('Create session error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse(data, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/sessions - List user's sessions
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : undefined;

    const supabase = await createClient();

    // Check authentication (supports both cookie and Bearer token)
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Get user's sessions (as host)
    let query = supabase
      .from('sessions')
      .select('*, session_participants(id)')
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('List sessions error:', error);
      return errorResponse(error.message, 400);
    }

    // Transform to include participant_count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionsWithCount = data.map((session: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const participants = session.session_participants;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return {
        ...session,
        participant_count: Array.isArray(participants) ? participants.length : 0,
        session_participants: undefined, // Remove the raw array
      };
    });

    return successResponse(sessionsWithCount);
  } catch (error) {
    return handleApiError(error);
  }
}
