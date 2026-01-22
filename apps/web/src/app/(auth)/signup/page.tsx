import { SignupForm } from '@/components/auth';

export const metadata = {
  title: 'Sign Up - PairUX',
  description: 'Create a PairUX account to start sharing your screen',
};

export default function SignupPage() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Create an account</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sign up to start sharing your screen and collaborating
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
