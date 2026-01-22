/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-template-expressions */
import { createClient } from '@/lib/supabase/server';
import { resetPasswordSchema } from '@/lib/validations';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = resetPasswordSchema.parse(body);

    const supabase = await createClient();

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      return errorResponse(error.message, 400);
    }

    return successResponse({ message: 'Password updated successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
