import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const headersList = await headers();
  const origin = headersList.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Session established, redirect to reset password form
      return NextResponse.redirect(`${origin}/reset-password`);
    }

    console.error('Password reset code exchange error:', error);
  }

  // Return to reset password page with error
  return NextResponse.redirect(`${origin}/reset-password?error=invalid_code`);
}
