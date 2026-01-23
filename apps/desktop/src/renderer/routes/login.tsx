import { LoginForm } from '@/components/auth/LoginForm';

export function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Simple drag region for window control */}
      <div className="drag-region h-8 w-full" />

      <div className="flex flex-1 items-center justify-center p-6">
        <LoginForm />
      </div>
    </div>
  );
}
