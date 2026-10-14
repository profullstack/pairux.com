import {
  useMeetingTranslation as useSharedMeetingTranslation,
  type MeetingParticipantAudio,
  type MeetingTranslationEnvironment,
} from '@pairux/meeting-translation';
import { getAudioContext } from '@/lib/audioContext';
import { getElectronAPI } from '@/lib/ipc';
import { setRemoteTrackDuck } from '@/lib/remoteAudioGain';
import { API_BASE_URL } from '../../shared/config';

export type { MeetingParticipantAudio } from '@pairux/meeting-translation';

// The feeder posts every 2 s; ask the main process for the token once a minute.
let cached: { token: string | null; until: number } = { token: null, until: 0 };
async function bearer(): Promise<HeadersInit> {
  if (Date.now() >= cached.until) {
    const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
    cached = { token: token ?? null, until: Date.now() + 60_000 };
  }
  return cached.token ? { Authorization: `Bearer ${cached.token}` } : {};
}

/** pairux.com over HTTPS with the desktop Bearer token; the tap ships as a file (CSP). */
const DESKTOP: MeetingTranslationEnvironment = {
  apiBase: API_BASE_URL,
  headers: bearer,
  audioContext: getAudioContext,
  duck: setRemoteTrackDuck,
  // A real file (renderer public dir): Vite inlines small `?url` assets as data:
  // URLs, which this CSP (script-src 'self') refuses just like blob:.
  workletUrl: new URL('translationTap.worklet.js', document.baseURI).href,
};

/** Live meeting translation in the desktop app (see @pairux/meeting-translation). */
export function useMeetingTranslation(options: {
  sessionId: string;
  selfId: string;
  participants: MeetingParticipantAudio[];
}) {
  return useSharedMeetingTranslation({ ...options, env: DESKTOP });
}
export type MeetingTranslation = ReturnType<typeof useMeetingTranslation>;
