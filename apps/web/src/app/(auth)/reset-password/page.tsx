import { ResetPasswordForm } from '@/components/auth';

export const metadata = {
  title: 'Reset Password - PairUX',
  description: 'Set a new password for your PairUX account',
};

export default function ResetPasswordPage() {
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
