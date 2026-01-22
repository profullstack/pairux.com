import { createClient } from '@/lib/supabase/server';
import { forgotPasswordSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { headers } from 'next/headers';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    const supabase = await createClient();
    const headersList = await headers();
    const origin = headersList.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });

    if (error) {
      return errorResponse(error.message, 400);
    }

    // Always return success to prevent email enumeration
    return successResponse({
      message: 'If an account exists with that email, you will receive a password reset link',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
