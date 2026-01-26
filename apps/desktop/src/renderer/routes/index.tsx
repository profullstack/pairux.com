import { createHashRouter, Navigate, Outlet } from 'react-router-dom';
import { LoginPage } from './login';
import { HomePage } from './home';
import { JoinPage } from './join';
import { ViewerPage } from './viewer';
import { SettingsPage } from './settings';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

export const router = createHashRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    // Join page - accessible without authentication (allows guest joining)
    path: '/join',
    element: <JoinPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <Outlet />
        </AppLayout>
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        // Viewer page for watching a session
        path: 'viewer/:sessionId',
        element: <ViewerPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
