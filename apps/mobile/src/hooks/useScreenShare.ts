import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';

export type ScreenShareState = 'idle' | 'requesting' | 'publishing' | 'active' | 'stopping';

interface UseScreenShareOptions {
  publishStream: (stream: MediaStream) => Promise<void>;
  unpublishStream: () => Promise<void>;
}

interface UseScreenShareReturn {
  state: ScreenShareState;
  isSharing: boolean;
  isBusy: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  clearError: () => void;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function getStartError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to start screen sharing. Please check the capture permission and try again.';
}

/** Owns the native capture stream and serializes every screen-share transition. */
export function useScreenShare({
  publishStream,
  unpublishStream,
}: UseScreenShareOptions): UseScreenShareReturn {
  const [state, setState] = useState<ScreenShareState>('idle');
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<ScreenShareState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const publicationRef = useRef<Promise<void> | null>(null);
  const endedListenersRef = useRef<Map<MediaStreamTrack, () => void>>(new Map());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const transition = useCallback((nextState: ScreenShareState) => {
    stateRef.current = nextState;
    if (mountedRef.current) {
      setState(nextState);
    }
  }, []);

  const detachEndedListeners = useCallback(() => {
    for (const [track, listener] of endedListenersRef.current) {
      track.removeEventListener('ended', listener);
    }
    endedListenersRef.current.clear();
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    if (stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    if (stateRef.current === 'idle' && !streamRef.current) {
      return;
    }

    generationRef.current += 1;
    transition('stopping');

    const stream = streamRef.current;
    const publication = publicationRef.current;
    streamRef.current = null;
    detachEndedListeners();
    if (stream) {
      stopTracks(stream);
    }

    const stopPromise = (async () => {
      await Promise.resolve();
      try {
        if (stream) {
          try {
            await publication;
          } catch {
            // Publishing performs its own rollback; local teardown still continues.
          }
          await unpublishStream();
        }
      } catch (unpublishError) {
        console.error('[ScreenShare] Failed to unpublish capture:', unpublishError);
      } finally {
        transition('idle');
        stopPromiseRef.current = null;
      }
    })();

    stopPromiseRef.current = stopPromise;
    return stopPromise;
  }, [detachEndedListeners, transition, unpublishStream]);

  const attachEndedListeners = useCallback(
    (stream: MediaStream) => {
      for (const track of stream.getTracks()) {
        const listener = () => {
          void stop();
        };
        track.addEventListener('ended', listener);
        endedListenersRef.current.set(track, listener);
      }
    },
    [stop]
  );

  const start = useCallback(async (): Promise<boolean> => {
    if (appStateRef.current !== 'active' || stateRef.current !== 'idle' || stopPromiseRef.current) {
      return false;
    }

    const generation = ++generationRef.current;
    transition('requesting');
    setError(null);

    let stream: MediaStream | null = null;
    let publication: Promise<void> | null = null;
    try {
      stream = await mediaDevices.getDisplayMedia();

      if (generationRef.current !== generation) {
        stopTracks(stream);
        return false;
      }

      streamRef.current = stream;
      attachEndedListeners(stream);
      transition('publishing');
      publication = publishStream(stream);
      publicationRef.current = publication;
      await publication;

      if (generationRef.current !== generation || streamRef.current !== stream) {
        return false;
      }

      transition('active');
      return true;
    } catch (startError) {
      const ownsTransition = generationRef.current === generation;
      if (ownsTransition) {
        if (streamRef.current === stream) {
          streamRef.current = null;
        }
        detachEndedListeners();
        if (stream) {
          stopTracks(stream);
          try {
            await unpublishStream();
          } catch (rollbackError) {
            console.error('[ScreenShare] Failed to roll back capture:', rollbackError);
          }
        }
      }

      if (mountedRef.current && ownsTransition) {
        setError(
          stream
            ? 'Could not share your screen with viewers. Check your connection and try again.'
            : getStartError(startError)
        );
        transition('idle');
      }
      return false;
    } finally {
      if (publicationRef.current === publication) {
        publicationRef.current = null;
      }
    }
  }, [attachEndedListeners, detachEndedListeners, publishStream, transition, unpublishStream]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Native capture belongs to this hook. End it explicitly when the app is
  // backgrounded so the UI cannot keep claiming that a stopped track is live.
  useEffect(() => {
    appStateRef.current = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'background' && previousState !== 'background') {
        void stop();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      const stream = streamRef.current;
      const publication = publicationRef.current;
      streamRef.current = null;
      detachEndedListeners();
      if (stream) {
        stopTracks(stream);
        void (async () => {
          try {
            await publication;
          } catch {
            // Publishing performs its own rollback; local teardown still continues.
          }
          try {
            await unpublishStream();
          } catch (unpublishError) {
            console.error('[ScreenShare] Failed to unpublish during cleanup:', unpublishError);
          }
        })();
      }
    };
  }, [detachEndedListeners, unpublishStream]);

  return {
    state,
    isSharing: state === 'active',
    isBusy: state !== 'idle' && state !== 'active',
    error,
    start,
    stop,
    clearError,
  };
}
