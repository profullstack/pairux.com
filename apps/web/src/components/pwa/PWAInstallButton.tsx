'use client';

import { InstallPrompt } from './InstallPrompt';

/**
 * Client-side PWA install button wrapper
 * Use this in server components like the root layout
 */
export function PWAInstallButton() {
  return <InstallPrompt variant="button" />;
}
