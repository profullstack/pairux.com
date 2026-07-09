import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { usernameSchema } from '@/lib/validations';

interface ProfileUsername {
  username?: string | null;
}

/**
 * GET /api/profile/username
 * Returns the authenticated user's current public username (or null).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Get username error:', error);
      return errorResponse('Failed to load username', 500);
    }

    return successResponse({ username: (data as ProfileUsername | null)?.username ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/profile/username
 * Claims or changes the authenticated user's public username.
 * Body: { username: string }
 */
export async function PUT(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const { username } = usernameSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('set_username', {
      p_username: username,
    });

    if (error) {
      console.error('Set username error:', error);
      const message: string = (error as { message?: string }).message ?? 'Failed to set username';
      // Surface uniqueness as a 409 so the UI can show a friendly message
      const status = message.toLowerCase().includes('already') ? 409 : 400;
      return errorResponse(message, status);
    }

    const savedUsername: string | null = (data as ProfileUsername | null)?.username ?? username;
    return successResponse({ username: savedUsername });
  } catch (error) {
    return handleApiError(error);
  }
}
