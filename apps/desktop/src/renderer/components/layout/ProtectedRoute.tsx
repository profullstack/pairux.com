import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, checkSession, isInitialized } = useAuthStore();
  const location = useLocation();
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  useEffect(() => {
    if (!isInitialized) {
      void checkSession().finally(() => {
        setInitialCheckDone(true);
      });
    } else {
      setInitialCheckDone(true);
    }
  }, [checkSession, isInitialized]);

  // Show loading state while checking session
  if (isLoading || !initialCheckDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
