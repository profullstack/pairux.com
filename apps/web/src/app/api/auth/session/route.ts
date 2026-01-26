import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, handleApiError } from '@/lib/api';

export async function GET() {
  try {
    const supabase = await createClient();

    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return successResponse({ user: null, profile: null });
    }

    // Fetch profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 = Row not found, which is ok for new users
      console.error('Profile fetch error:', profileError);
    }

    return successResponse({
      user: {
        id: user.id,
        email: user.email,
      },
      profile,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
