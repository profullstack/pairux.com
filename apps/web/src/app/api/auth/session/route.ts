/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions */
import { createClient } from '@/lib/supabase/server';
import { successResponse, handleApiError } from '@/lib/api';

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

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
      profile: profile || null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
