import { ForgotPasswordForm } from '@/components/auth';

export const metadata = {
  title: 'Forgot Password - PairUX',
  description: 'Reset your PairUX account password',
};

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
