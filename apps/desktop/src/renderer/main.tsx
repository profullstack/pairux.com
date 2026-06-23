import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { getElectronAPI, isElectron } from './lib/ipc';
import { useUIStore } from './stores/ui';
import './styles/globals.css';

// Listen for navigation events from main process (menu, tray, etc.)
if (isElectron()) {
  const api = getElectronAPI();
  api.on('navigate', (path) => {
    // Settings is an overlay, not a route — routing to it would unmount the
    // active session on Home and end it. Open the overlay instead.
    if (path === '/settings') {
      useUIStore.getState().openSettings();
      return;
    }
    void router.navigate(path);
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
}
