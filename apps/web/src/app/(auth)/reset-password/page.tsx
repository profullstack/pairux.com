import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ResetPasswordForm } from '@/components/auth';

export const metadata = {
  title: 'Reset Password - PairUX',
  description: 'Set a new password for your PairUX account',
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ code?: string; error?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const code = params.code;
  const error = params.error;

  // If there's an error from the callback
  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Reset link expired</h1>
          <p className="mt-2 text-sm text-gray-600">
            This password reset link has expired or is invalid. Please request a new one.
          </p>
          <a
            href="/forgot-password"
            className="mt-6 inline-block rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Request new link
          </a>
        </div>
      </div>
    );
  }

  const supabase = await createClient();

  // If there's a code, exchange it for a session
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error('Code exchange error:', exchangeError);
      redirect('/reset-password?error=invalid_code');
    }

    // Code exchanged successfully - show the form directly without redirect
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="mt-2 text-sm text-gray-600">Enter your new password below</p>
        </div>
        <ResetPasswordForm />
      </div>
    );
  }

  // Check if user has an active session (required to update password)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Session expired</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your password reset session has expired. Please request a new reset link.
          </p>
          <a
            href="/forgot-password"
            className="mt-6 inline-block rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Request new link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
        <p className="mt-2 text-sm text-gray-600">Enter your new password below</p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
