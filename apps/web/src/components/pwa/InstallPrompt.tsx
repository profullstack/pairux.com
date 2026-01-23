'use client';

import { useState } from 'react';
import { Download, X, Monitor, Smartphone } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

interface InstallPromptProps {
  /** Additional CSS classes */
  className?: string;
  /** Show as a banner (default) or floating button */
  variant?: 'banner' | 'button';
}

/**
 * PWA Install Prompt Component
 *
 * Shows an install prompt when the app can be installed as a PWA.
 * Automatically hides if already installed or user has dismissed.
 *
 * @example
 * ```tsx
 * // Banner at bottom of screen
 * <InstallPrompt variant="banner" />
 *
 * // Floating button
 * <InstallPrompt variant="button" />
 * ```
 */
export function InstallPrompt({ className = '', variant = 'banner' }: InstallPromptProps) {
  const { canInstall, isInstalled, isDismissed, install, dismiss, platform } = usePWAInstall();
  const [isInstalling, setIsInstalling] = useState(false);

  // Don't show if can't install, already installed, or dismissed
  if (!canInstall || isInstalled || isDismissed) {
    return null;
  }

  const handleInstall = () => {
    setIsInstalling(true);
    install()
      .catch(console.error)
      .finally(() => {
        setIsInstalling(false);
      });
  };

  const isMobile = platform === 'android' || platform === 'ios';
  const Icon = isMobile ? Smartphone : Monitor;

  if (variant === 'button') {
    return (
      <button
        onClick={handleInstall}
        disabled={isInstalling}
        className={`fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 font-medium text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl disabled:opacity-75 ${className}`}
        aria-label="Install PairUX app"
      >
        <Download className="h-5 w-5" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  // Banner variant (default)
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 border-t border-gray-700 bg-gray-800 p-4 shadow-lg ${className}`}
      role="alert"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-medium text-white">Install PairUX</p>
            <p className="text-sm text-gray-400">
              {isMobile
                ? 'Add to your home screen for quick access'
                : 'Install the desktop app for a better experience'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={dismiss}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            aria-label="Dismiss install prompt"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-75"
          >
            <Download className="h-4 w-4" />
            <span>{isInstalling ? 'Installing...' : 'Install'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
