'use client';

import {
  useMeetingTranslation as useSharedMeetingTranslation,
  type MeetingParticipantAudio,
  type MeetingTranslationEnvironment,
} from '@pairux/meeting-translation';
import { getAudioContext } from '@/lib/audioContext';
import { setRemoteTrackDuck } from '@/lib/remoteAudioGain';

export type {
  MeetingParticipantAudio,
  ParticipantChoice,
  TranslatedLine,
  TranslationAccessInfo,
  TranslationPassInfo,
} from '@pairux/meeting-translation';

/** Same origin, cookie auth: only the audio plumbing is the web app's own. */
const WEB: MeetingTranslationEnvironment = {
  audioContext: getAudioContext,
  duck: setRemoteTrackDuck,
};

/** Live meeting translation for one participant's page (see @pairux/meeting-translation). */
export function useMeetingTranslation(options: {
  sessionId: string;
  selfId: string;
  participants: MeetingParticipantAudio[];
}) {
  return useSharedMeetingTranslation({ ...options, env: WEB });
}
export type MeetingTranslation = ReturnType<typeof useMeetingTranslation>;
