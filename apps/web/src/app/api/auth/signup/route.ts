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
        // Skip email confirmation for now - remove this line once SMTP is working
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com'}/auth/callback`,
      },
    });

    if (error) {
      console.error('Supabase signup error:', {
        message: error.message,
        status: error.status,
        code: error.code,
        name: error.name,
      });
      return errorResponse(error.message, 400);
    }

    if (!data.user) {
      return errorResponse('Failed to create user', 500);
    }

    // Check if user needs email confirmation or is already confirmed
    const needsConfirmation = !data.user.confirmed_at && !data.session;

    return successResponse(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        message: needsConfirmation
          ? 'Check your email to confirm your account'
          : 'Account created successfully',
        needsConfirmation,
      },
      201
    );
  } catch (error) {
    console.error('Signup route error:', error);
    return handleApiError(error);
  }
}
