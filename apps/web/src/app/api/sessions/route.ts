import { effectivePlan, maxListeners, type Plan } from '@pairux/shared-types';
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

    // Clamp room capacity to the owner's plan. Free hosts 5 listeners; Plus 100;
    // Pro/Team more. Baking the cap into settings.maxParticipants means the
    // join_session RPC enforces it on every join. A lapsed paid plan falls back
    // to free via effectivePlan().
    const { data: profile } = (await supabase
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', user.id)
      .single()) as { data: { plan: Plan; plan_expires_at: string | null } | null };
    const plan = effectivePlan(profile?.plan ?? 'free', profile?.plan_expires_at ?? null);
    const cap = maxListeners(plan);
    const maxParticipants = Math.min(settings.maxParticipants, cap);

    // Create session using RPC function

    const rpcParams: Record<string, unknown> = {
      p_settings: {
        quality: 'medium',
        allowControl: settings.allowGuestControl,
        maxParticipants,
      },
      p_mode: settings.mode,
    };
    if (settings.joinCode) rpcParams.p_join_code = settings.joinCode;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('create_session', rpcParams);

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
