import { LoginForm } from '@/components/auth/LoginForm';

export function LoginPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Simple drag region for window control */}
      <div className="drag-region h-8 w-full" />

      <div className="p-6 flex flex-1 items-center justify-center">
        <LoginForm />
      </div>
    </div>
  );
}
