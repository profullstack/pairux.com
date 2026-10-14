import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomFeeder, RoomListener, type RoomChoice } from '@profullstack/live-translate/browser';
import { defaultListenLanguage } from './languages.js';

/** What differs between the web app and the desktop app. */
export interface MeetingTranslationEnvironment {
  /** '' on the web (same origin); https://pairux.com from the desktop app. */
  apiBase?: string;
  /** Auth for each request (the desktop app's Bearer token). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  /** The page's shared AudioContext (remote audio already plays through it). */
  audioContext: () => AudioContext;
  /** Turn one remote track's original voice down (factor 0..1, 1 = normal). */
  duck: (trackId: string, factor: number) => void;
  /** A served copy of the audio-tap worklet, for a CSP without blob: scripts. */
  workletUrl?: string;
  /** Open a CoinPay checkout (Electron sends it to the system browser). */
  openUrl?: (url: string) => void;
}

export interface MeetingParticipantAudio {
  identity: string;
  name: string;
  track: MediaStreamTrack;
}
/** This listener's choice for one participant. Off = neither voice nor text. */
export interface ParticipantChoice {
  from: string;
  to: string;
  audio: boolean;
  text: boolean;
}
export interface TranslatedLine {
  id: string;
  participant: string;
  name: string;
  text: string;
  original?: string | undefined;
  language?: string | undefined;
  at: number;
}
export interface TranslationAccessInfo {
  balanceMicros: number;
  expires: string | null;
  freeLeft: number;
  freeLimit: number;
}
export interface TranslationPassInfo {
  id: string;
  name: string;
  days: number;
  priceUsd: number;
}

interface Status {
  available: boolean;
  listening: number;
  funded: boolean;
  isHost: boolean;
  access: TranslationAccessInfo | null;
  passes: TranslationPassInfo[];
}

const LANGUAGE_KEY = 'pairux.translation.to';
const ORIGINAL_KEY = 'pairux.translation.original';
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked */
  }
};

/**
 * Live meeting translation for one participant's page: hear everyone else in
 * your language (or read them), each person's source and target chosen by you.
 * The meeting host pays; see /api/sessions/:id/translation.
 */
export function useMeetingTranslation({
  sessionId,
  selfId,
  participants,
  env,
}: {
  sessionId: string;
  selfId: string;
  participants: MeetingParticipantAudio[];
  env: MeetingTranslationEnvironment;
}) {
  // Read through a ref: callers pass a fresh object each render.
  const envRef = useRef(env);
  envRef.current = env;
  const api = useCallback(async (path: string, init: RequestInit = {}): Promise<Response> => {
    const { apiBase = '', headers } = envRef.current;
    const merged = new Headers(init.headers);
    new Headers(await headers?.()).forEach((value, key) => {
      merged.set(key, value);
    });
    return fetch(`${apiBase}${path}`, { ...init, headers: merged });
  }, []);
  const [status, setStatus] = useState<Status | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [listenTo, setListenToState] = useState('en');
  const [overrides, setOverrides] = useState<Record<string, Partial<ParticipantChoice>>>({});
  const [lines, setLines] = useState<TranslatedLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [originalVolume, setOriginalVolumeState] = useState(0.15);
  const [voiced, setVoiced] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setListenToState(
      read(LANGUAGE_KEY) ??
        defaultListenLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)
    );
    const original = Number(read(ORIGINAL_KEY));
    if (Number.isFinite(original) && original >= 0 && original <= 1 && read(ORIGINAL_KEY) !== null)
      setOriginalVolumeState(original);
  }, []);

  const others = useMemo(() => {
    const seen = new Map<string, MeetingParticipantAudio>();
    for (const one of participants) if (one.identity !== selfId) seen.set(one.identity, one);
    return [...seen.values()];
  }, [participants, selfId]);
  const names = useRef(new Map<string, string>());
  others.forEach((one) => names.current.set(one.identity, one.name));

  const choiceFor = useCallback(
    (identity: string): ParticipantChoice => ({
      from: '',
      to: listenTo,
      audio: true,
      text: true,
      ...overrides[identity],
    }),
    [listenTo, overrides]
  );

  // Status: availability, the host's credit, and whether anyone in the room
  // is listening (which is what turns this client's feeder on).
  const refresh = useCallback(async () => {
    if (!selfId) return;
    try {
      const response = await api(
        `/api/sessions/${sessionId}/translation?participantId=${encodeURIComponent(selfId)}`
      );
      const body = (await response.json().catch(() => ({}))) as { data?: Status };
      if (response.ok && body.data) setStatus(body.data);
    } catch {
      /* offline: keep the last status */
    }
  }, [api, sessionId, selfId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);

  // Feeder: tap the tracks this client receives while anyone is listening.
  const feederRef = useRef<RoomFeeder | null>(null);
  const feeding = Boolean(status?.available) && ((status?.listening ?? 0) > 0 || enabled);
  useEffect(() => {
    if (!feeding) {
      feederRef.current?.stop();
      feederRef.current = null;
      return;
    }
    const { apiBase = '', headers, audioContext, workletUrl } = envRef.current;
    feederRef.current ??= new RoomFeeder({
      path: `${apiBase}/api/sessions/${sessionId}/translation/feed?self=${encodeURIComponent(selfId)}`,
      context: audioContext,
      ...(headers ? { headers } : {}),
      ...(workletUrl ? { workletUrl } : {}),
    });
    const feeder = feederRef.current;
    const live = new Set(others.map((one) => one.identity));
    for (const one of others)
      if (!feeder.has(one.identity))
        void feeder.add(one.identity, one.track).catch(() => {
          feeder.remove(one.identity);
        });
    for (const one of participants) if (!live.has(one.identity)) feeder.remove(one.identity);
  }, [feeding, others, participants, sessionId, selfId]);
  useEffect(
    () => () => {
      feederRef.current?.stop();
      feederRef.current = null;
    },
    []
  );

  // Listener: one event stream carrying this listener's choices.
  const listenerRef = useRef<RoomListener | null>(null);
  if (!listenerRef.current && typeof window !== 'undefined') {
    listenerRef.current = new RoomListener({
      path: `/api/sessions/${sessionId}/translation/listen`,
      // Base URL and auth (the desktop app's Bearer token) on the event stream.
      fetcher: ((input: RequestInfo | URL, init?: RequestInit) =>
        api(String(input), init)) as typeof fetch,
      line: ({ participant, line, audio }) => {
        if (audio)
          setVoiced((prev) => (prev.has(participant) ? prev : new Set(prev).add(participant)));
        setLines((prev) =>
          [
            ...prev,
            {
              id: `${participant}|${String(line.at)}|${line.language ?? ''}`,
              participant,
              name: names.current.get(participant) ?? 'Participant',
              text: line.text,
              original: line.original,
              language: line.language,
              at: line.at,
            },
          ].slice(-200)
        );
      },
      status: (text) => {
        setMessage(text);
      },
      failed: (participant, error) => {
        setErrors((prev) => ({ ...prev, [participant]: error }));
        setOverrides((prev) => ({
          ...prev,
          [participant]: { ...prev[participant], audio: false, text: false },
        }));
      },
      stopped: (error) => {
        setMessage(error);
        setEnabledState(false);
      },
    });
  }

  const choices = useMemo<RoomChoice[]>(() => {
    if (!enabled) return [];
    return others
      .map((one) => ({ participant: one.identity, ...choiceFor(one.identity) }))
      .filter((choice) => choice.audio || choice.text)
      .map((choice) => ({ ...choice, audio: choice.audio && choice.to !== '' }));
  }, [enabled, others, choiceFor]);
  const choiceKey = JSON.stringify(choices);
  useEffect(() => {
    const listener = listenerRef.current;
    if (!listener) return;
    // Settle rapid edits (a language picked, then another) into one reconnect.
    const timer = setTimeout(() => {
      void listener.set(choices).catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Live translation is unavailable.');
        setEnabledState(false);
      });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choiceKey is the stable form of choices
  }, [choiceKey]);
  useEffect(() => () => listenerRef.current?.stop(), []);

  // Ducking: once someone's translated voice is heard, keep their own voice low
  // while their translated voice stays on.
  useEffect(() => {
    for (const one of others) {
      const choice = choiceFor(one.identity);
      const duck = enabled && choice.audio && choice.to !== '' && voiced.has(one.identity);
      envRef.current.duck(one.track.id, duck ? originalVolume : 1);
    }
  }, [others, enabled, choiceFor, voiced, originalVolume]);
  useEffect(
    () => () => {
      for (const one of others) envRef.current.duck(one.track.id, 1);
    },
    [others]
  );

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      setErrors({});
      if (!on) {
        setVoiced(new Set());
        setMessage('');
      }
      void refresh();
    },
    [refresh]
  );
  const setListenTo = useCallback((code: string) => {
    setListenToState(code);
    write(LANGUAGE_KEY, code);
    setVoiced(new Set());
  }, []);
  const setChoice = useCallback((identity: string, patch: Partial<ParticipantChoice>) => {
    setOverrides((prev) => ({ ...prev, [identity]: { ...prev[identity], ...patch } }));
    setErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => key !== identity))
    );
    setVoiced((prev) => {
      const next = new Set(prev);
      next.delete(identity);
      return next;
    });
  }, []);
  const setOriginalVolume = useCallback((value: number) => {
    setOriginalVolumeState(value);
    write(ORIGINAL_KEY, String(value));
  }, []);

  const buyPass = useCallback(
    async (pass: string) => {
      const response = await api('/api/billing/translation-checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pass }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { checkout_url?: string | null };
        error?: string;
      };
      if (!response.ok || !body.data?.checkout_url)
        throw new Error(body.error ?? 'Checkout is unavailable.');
      const open =
        envRef.current.openUrl ?? ((url: string) => window.open(url, '_blank', 'noopener'));
      open(body.data.checkout_url);
    },
    [api]
  );

  return {
    available: Boolean(status?.available),
    isHost: Boolean(status?.isHost),
    access: status?.access ?? null,
    passes: status?.passes ?? [],
    listening: status?.listening ?? 0,
    /** The host's pass covers this meeting (translation is a paid feature). */
    funded: Boolean(status?.funded),
    enabled,
    setEnabled,
    listenTo,
    setListenTo,
    participants: others,
    choiceFor,
    setChoice,
    lines,
    errors,
    message,
    originalVolume,
    setOriginalVolume,
    buyPass,
    refresh,
  };
}
export type MeetingTranslation = ReturnType<typeof useMeetingTranslation>;
