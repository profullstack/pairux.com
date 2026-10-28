'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { CopilotPanel, useMeetingCopilot, type CopilotT } from '@pairux/meeting-copilot';

/** The AI copilot for a meeting page (same origin, cookie auth). */
export function MeetingCopilot({ sessionId, selfId }: { sessionId: string; selfId: string }) {
  const copilot = useMeetingCopilot({ sessionId, selfId, env: {} });
  const intl = useTranslations('copilot');
  const t = useCallback<CopilotT>((key, values) => intl(key, values), [intl]);
  return (
    <div className="pointer-events-none fixed right-4 bottom-20 z-40 flex w-[min(24rem,calc(100vw-2rem))] justify-end">
      <CopilotPanel copilot={copilot} t={t} className="pointer-events-auto" />
    </div>
  );
}
