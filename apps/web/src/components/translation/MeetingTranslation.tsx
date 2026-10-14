'use client';

import { useMeetingTranslation, type MeetingParticipantAudio } from '@/hooks/useMeetingTranslation';
import { TranslationPanel } from './TranslationPanel';

/** Live translation for a meeting page: renders nothing unless the server has it configured. */
export function MeetingTranslation({
  sessionId,
  selfId,
  participants,
}: {
  sessionId: string;
  selfId: string;
  participants: MeetingParticipantAudio[];
}) {
  const translation = useMeetingTranslation({ sessionId, selfId, participants });
  return (
    <div className="pointer-events-none fixed bottom-20 left-4 z-40 w-[min(22rem,calc(100vw-2rem))]">
      <TranslationPanel translation={translation} className="pointer-events-auto shadow-xl" />
    </div>
  );
}
