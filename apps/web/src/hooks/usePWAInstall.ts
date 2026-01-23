'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface UsePWAInstallResult {
  /** Whether the PWA can be installed (install prompt is available) */
  canInstall: boolean;
  /** Whether the PWA is already installed */
  isInstalled: boolean;
  /** Whether the user has dismissed the install prompt before */
  isDismissed: boolean;
  /** Trigger the install prompt */
  install: () => Promise<boolean>;
  /** Dismiss the install prompt and remember preference */
  dismiss: () => void;
  /** The platform the app will be installed on */
  platform: string | null;
}

const STORAGE_KEY = 'pwa-install-dismissed';
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hook to manage PWA installation
 *
 * @example
 * ```tsx
 * const { canInstall, isInstalled, install, dismiss } = usePWAInstall();
 *
 * if (canInstall && !isInstalled) {
 *   return <button onClick={install}>Install App</button>;
 * }
 * ```
 */
export function usePWAInstall(): UsePWAInstallResult {
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [platform, setPlatform] = useState<string | null>(null);

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  // Check if app is already installed
  useEffect(() => {
    // Check standalone mode (installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

    setIsInstalled(isStandalone);

    // Check if user previously dismissed
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      if (Date.now() - dismissedTime < DISMISS_DURATION) {
        setIsDismissed(true);
      } else {
        // Dismiss period expired, remove the key
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  // Listen for beforeinstallprompt event
  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      event.preventDefault();

      // Store the event for later use
      const promptEvent = event as BeforeInstallPromptEvent;
      deferredPromptRef.current = promptEvent;

      // Get platform info
      const firstPlatform = promptEvent.platforms[0];
      if (firstPlatform) {
        setPlatform(firstPlatform);
      }

      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      // Clear the deferred prompt
      deferredPromptRef.current = null;
      setCanInstall(false);
      setIsInstalled(true);

      // Clear any dismiss state
      localStorage.removeItem(STORAGE_KEY);
      setIsDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const promptEvent = deferredPromptRef.current;

    if (!promptEvent) {
      console.warn('Install prompt not available');
      return false;
    }

    // Show the install prompt
    await promptEvent.prompt();

    // Wait for the user to respond
    const choiceResult = await promptEvent.userChoice;

    // Clear the deferred prompt
    deferredPromptRef.current = null;
    setCanInstall(false);

    if (choiceResult.outcome === 'accepted') {
      return true;
    }

    return false;
  }, []);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  }, []);

  return {
    canInstall,
    isInstalled,
    isDismissed,
    install,
    dismiss,
    platform,
  };
}
