import { createClient } from '@/lib/supabase/server';
import { signupSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { email, password, firstName, lastName } = signupSchema.parse(body);

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          display_name: `${firstName} ${lastName}`,
        },
      },
    });

    if (error) {
      return errorResponse(error.message, 400);
    }

    if (!data.user) {
      return errorResponse('Failed to create user', 500);
    }

    return successResponse({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      message: 'Check your email to confirm your account',
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
