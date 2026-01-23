import { createClient } from '@supabase/supabase-js';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  accessToken: z.string().min(1, 'Access token is required'),
});

// Server-side Supabase admin client
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { password, accessToken } = resetPasswordSchema.parse(body);

    const supabase = getSupabaseAdmin();

    // Verify the access token and get user
    const {
      data: { user },
      error: verifyError,
    } = await supabase.auth.getUser(accessToken);

    if (verifyError || !user) {
      console.error('Token verification error:', verifyError);
      return errorResponse('Invalid or expired reset link', 400);
    }

    // Update the user's password using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });

    if (updateError) {
      console.error('Password update error:', updateError);
      return errorResponse('Failed to update password. Please try again.', 500);
    }

    return successResponse({ message: 'Password updated successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
