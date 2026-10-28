'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  CopilotPanel,
  useMeetingAgents,
  useMeetingCopilot,
  type CopilotT,
  type MeetingCopilotEnvironment,
} from '@pairux/meeting-copilot';
import { dataKeyFromSecret } from '@/lib/sealed/unlock-secret';

/** Same origin, cookie auth; own keys unlock in this browser (only the data key is sent). */
const WEB: MeetingCopilotEnvironment = { unlockKeys: dataKeyFromSecret };

/** The AI copilot and your agents for a meeting page (same origin, cookie auth). */
export function MeetingCopilot({ sessionId, selfId }: { sessionId: string; selfId: string }) {
  const copilot = useMeetingCopilot({ sessionId, selfId, env: WEB });
  const agents = useMeetingAgents({ sessionId, selfId, env: {} });
  const intl = useTranslations('copilot');
  const t = useCallback<CopilotT>((key, values) => intl(key, values), [intl]);
  return (
    <div className="pointer-events-none fixed right-4 bottom-20 z-40 flex w-[min(24rem,calc(100vw-2rem))] justify-end">
      <CopilotPanel copilot={copilot} agents={agents} t={t} className="pointer-events-auto" />
    </div>
  );
}
