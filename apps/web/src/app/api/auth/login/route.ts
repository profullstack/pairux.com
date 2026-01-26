/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-condition */
import { createClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return errorResponse(error.message, 401);
    }

    if (!data.user || !data.session) {
      return errorResponse('Invalid credentials', 401);
    }

    // Return tokens for desktop app authentication
    return successResponse({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
