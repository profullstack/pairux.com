import {
  CopilotPanel,
  copilotTranslator,
  useMeetingAgents,
  useMeetingCopilot,
  type MeetingCopilotEnvironment,
} from '@pairux/meeting-copilot';
import { getElectronAPI } from '@/lib/ipc';
import { API_BASE_URL } from '../../../shared/config';
// The web app's seal v2 client code (WebCrypto only): own keys unlock here too.
import { dataKeyFromSecret } from '../../../../../web/src/lib/sealed/unlock-secret';

// Ask the main process for the token once a minute.
let cached: { token: string | null; until: number } = { token: null, until: 0 };
async function bearer(): Promise<HeadersInit> {
  if (Date.now() >= cached.until) {
    const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
    cached = { token: token ?? null, until: Date.now() + 60_000 };
  }
  return cached.token ? { Authorization: `Bearer ${cached.token}` } : {};
}

/** pairux.com over HTTPS with the desktop Bearer token; links open in the system browser. */
const DESKTOP: MeetingCopilotEnvironment = {
  apiBase: API_BASE_URL,
  headers: bearer,
  openUrl: (url) => {
    void getElectronAPI().invoke('auth:openExternal', url);
  },
  unlockKeys: dataKeyFromSecret,
};

// The desktop app is not localized: the panel's English strings.
const t = copilotTranslator();

/** The AI copilot and your agents in the desktop app (see @pairux/meeting-copilot). */
export function MeetingCopilot({ sessionId, selfId }: { sessionId: string; selfId: string }) {
  const copilot = useMeetingCopilot({ sessionId, selfId, env: DESKTOP });
  const agents = useMeetingAgents({ sessionId, selfId, env: DESKTOP });
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] justify-end">
      <CopilotPanel copilot={copilot} agents={agents} t={t} className="pointer-events-auto" />
    </div>
  );
}
