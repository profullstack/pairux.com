/**
 * AI call analysis capture on the phone.
 *
 * react-native-webrtc has no MediaRecorder, so the phone records its own
 * microphone with expo-av instead, in 5-minute AAC segments uploaded as each
 * one closes (a crash loses at most the current segment). Other participants
 * are not in this recording; the report says so.
 *
 * Some devices will not let a second recorder share the microphone with the
 * live call. When recording cannot start, the status is 'error' and the host
 * screen says the phone is not recording, instead of failing silently.
 */
import { useEffect, useRef, useState } from 'react';
import type { Audio as ExpoAudio } from 'expo-av';
import type { CallAnalysisSettings } from '@pairux/shared-types';
import { API_BASE_URL } from '../config';
import { getAuthToken } from '../lib/api';

export type MobileCaptureStatus = 'off' | 'starting' | 'capturing' | 'finishing' | 'done' | 'error';

export const SEGMENT_MS = 5 * 60 * 1000;
const MIME = 'audio/mp4';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useCallAnalysisCapture({
  sessionId,
  settings,
  active,
}: {
  sessionId: string;
  settings: { analysis?: CallAnalysisSettings | undefined } | null | undefined;
  active: boolean;
}): MobileCaptureStatus {
  const enabled = settings?.analysis?.enabled === true;
  const [status, setStatus] = useState<MobileCaptureStatus>('off');
  const analysisIdRef = useRef<string | null>(null);
  const recordingRef = useRef<ExpoAudio.Recording | null>(null);
  const segmentStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadsRef = useRef<Promise<void>>(Promise.resolve());
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !active || startedRef.current) return;
    startedRef.current = true;
    // Flipped by the cleanup below, after the awaits in the start sequence.
    const run = { cancelled: false };

    // Loaded on first use: the native module is only touched when a call is
    // actually being analysed.
    let Audio: typeof ExpoAudio | null = null;
    const startSegment = async () => {
      Audio ??= (await import('expo-av')).Audio;
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      segmentStartRef.current = Date.now();
    };

    const closeSegment = async () => {
      const recording = recordingRef.current;
      const run = segmentStartRef.current;
      recordingRef.current = null;
      if (!recording || !analysisIdRef.current) return;
      await recording.stopAndUnloadAsync().catch(() => undefined);
      const uri = recording.getURI();
      if (!uri) return;
      const id = analysisIdRef.current;
      uploadsRef.current = uploadsRef.current.then(async () => {
        const blob = await (await fetch(uri)).blob();
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const res = await fetch(
              `${API_BASE_URL}/api/analyses/${id}/chunks?run=${String(run)}&index=0`,
              {
                method: 'PUT',
                headers: { ...(await authHeaders()), 'Content-Type': 'application/octet-stream' },
                body: blob,
              }
            );
            if (res.ok || res.status === 409) return;
          } catch {
            // retry
          }
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      });
    };

    void (async () => {
      setStatus('starting');
      try {
        Audio ??= (await import('expo-av')).Audio;
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) throw new Error('microphone permission denied');
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/analysis`, {
          method: 'POST',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'mobile', mimeType: MIME, chunkFormat: 'segments' }),
        });
        const body = (await res.json()) as { data?: { analysisId: string } };
        if (!res.ok || !body.data || run.cancelled) throw new Error('capture refused');
        analysisIdRef.current = body.data.analysisId;
        await startSegment();
        timerRef.current = setInterval(() => {
          void closeSegment()
            .then(startSegment)
            .catch(() => {
              setStatus('error');
            });
        }, SEGMENT_MS);
        setStatus('capturing');
      } catch (error) {
        console.warn('[CallAnalysis] could not start recording:', error);
        setStatus('error');
      }
    })();

    return () => {
      run.cancelled = true;
    };
  }, [enabled, active, sessionId]);

  // Finish when the call ends or the screen closes.
  useEffect(() => {
    const finish = async () => {
      if (!analysisIdRef.current) return;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setStatus('finishing');
      const recording = recordingRef.current;
      const run = segmentStartRef.current;
      recordingRef.current = null;
      const id = analysisIdRef.current;
      analysisIdRef.current = null;
      if (recording) {
        await recording.stopAndUnloadAsync().catch(() => undefined);
        const uri = recording.getURI();
        if (uri) {
          const blob = await (await fetch(uri)).blob();
          await uploadsRef.current;
          await fetch(`${API_BASE_URL}/api/analyses/${id}/chunks?run=${String(run)}&index=0`, {
            method: 'PUT',
            headers: { ...(await authHeaders()), 'Content-Type': 'application/octet-stream' },
            body: blob,
          }).catch(() => undefined);
        }
      }
      await uploadsRef.current;
      await fetch(`${API_BASE_URL}/api/analyses/${id}/finish`, {
        method: 'POST',
        headers: await authHeaders(),
      }).catch(() => undefined);
      setStatus('done');
    };
    if (!active) void finish();
    return () => {
      if (!active) return;
      void finish();
    };
  }, [active]);

  return enabled ? status : 'off';
}
