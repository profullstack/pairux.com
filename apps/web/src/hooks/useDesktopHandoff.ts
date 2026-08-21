'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildDesktopLink, launchDesktopApp, shouldTryDesktopApp } from '@/lib/desktopLaunch';

export type HandoffState = 'idle' | 'opening' | 'launched';

interface Options {
  /** Where the browser fallback goes. Defaults to a full page load. */
  navigate?: (path: string) => void;
}

/**
 * Start hosting a session in the desktop app, falling back to the web player.
 *
 * The session already exists by the time this runs — both callers create it
 * over the API first — so the desktop app and the browser are two ways of
 * picking up the same session, and landing in either one is correct.
 */
export function useDesktopHandoff(options: Options = {}) {
  const navigate =
    options.navigate ??
    ((path: string) => {
      window.location.href = path;
    });
  // Held in a ref so `openSession` stays stable across renders — callers put it
  // in effect and callback dependency lists.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });

  const [state, setState] = useState<HandoffState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const goToWebPlayer = useCallback((id: string) => {
    navigateRef.current(`/host/${id}`);
  }, []);

  const openSession = useCallback(
    (id: string) => {
      if (!shouldTryDesktopApp()) {
        goToWebPlayer(id);
        return;
      }

      setSessionId(id);
      setState('opening');
      cancelRef.current = launchDesktopApp(buildDesktopLink('host', id), {
        onLaunched: () => {
          // Leave the panel up: this tab is now the odd one out, and it has to
          // explain where the meeting went.
          setState('launched');
        },
        onFallback: () => {
          cancelRef.current = null;
          setState('idle');
          setSessionId(null);
          goToWebPlayer(id);
        },
      });
    },
    [goToWebPlayer]
  );

  /** The escape hatch: host in this browser after all. */
  const continueInBrowser = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    const id = sessionId;
    setState('idle');
    setSessionId(null);
    if (id) goToWebPlayer(id);
  }, [sessionId, goToWebPlayer]);

  useEffect(() => {
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, []);

  return { state, sessionId, openSession, continueInBrowser };
}
