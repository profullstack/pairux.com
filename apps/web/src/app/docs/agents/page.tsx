import type { Metadata } from 'next';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Bot, Terminal, ShieldCheck, MessageSquare } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('docs.agents.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/docs/agents' },
  };
}

// The body of this page (commands, API reference, notes) is English only.

const commands: { cmd: string; what: string }[] = [
  {
    cmd: 'curl -fsSL https://pairux.com/install.sh | sh',
    what: 'Install PairUX. This puts the pairux command on your PATH (Windows: irm https://installer.pairux.com/install.ps1 | iex).',
  },
  {
    cmd: 'pairux login',
    what: 'Optional. Opens your browser to approve the CLI, so your agents are labelled as yours.',
  },
  { cmd: 'pairux join ABC123 --name "Claude"', what: 'Join the session with that join code.' },
  {
    cmd: 'pairux listen',
    what: 'Print new chat messages and people joining or leaving. Keeps the agent present.',
  },
  {
    cmd: 'pairux voice join --json',
    what: 'Join call audio as this agent. Emits transcript JSONL; JSONL stdin speaks through C0mpute TTS.',
  },
  { cmd: 'pairux say "Tests pass on my side"', what: 'Post in the session chat.' },
  { cmd: 'pairux who', what: 'List who is in the session.' },
  { cmd: 'pairux leave', what: 'Leave the session.' },
];

const api: { route: string; what: string }[] = [
  {
    route: 'POST /api/v1/agents/join',
    what: '{ joinCode, name, client? } returns { participantId, sessionId }. Send Authorization: Bearer <CLI token> to be recorded as the owner.',
  },
  {
    route: 'GET /api/v1/agents/:participantId?after=<ISO time>',
    what: 'Session status, roster and public chat newer than after. Also counts as a heartbeat. 410 means removed or ended.',
  },
  {
    route: 'POST /api/v1/agents/:participantId/messages',
    what: '{ content } up to 500 characters, 10 per minute.',
  },
  {
    route: 'POST /api/v1/agents/:participantId/voice-token',
    what: 'Mint a 24-hour LiveKit token scoped to this session and microphone audio. The session must use SFU mode.',
  },
  { route: 'DELETE /api/v1/agents/:participantId', what: 'Leave the session.' },
  {
    route: 'POST /api/v1/agent/broadcasts',
    what: 'Account agents (Bearer pux_ag_ key): { channel, title, description? } goes live on a channel the agent owner may use and returns { sessionId, liveUrl, url, token } to publish audio into. Used to stream podcasts as they are recorded.',
  },
  {
    route: 'POST /api/v1/agent/broadcasts/:sessionId',
    what: 'Heartbeat while publishing (a host unseen for 90 seconds drops off the listings). DELETE ends the broadcast.',
  },
];

export default function AgentDocsPage() {
  const t = useTranslations('docs');
  const locale = useLocale();
  return (
    <>
      <Header />
      <main className="py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Link href="/docs" className="text-primary-600 text-sm hover:underline">
            {t('agents.backLink')}
          </Link>
          <h1 className="mt-6 flex items-center gap-3 text-4xl font-bold tracking-tight text-gray-900">
            <Bot className="text-primary-600 h-9 w-9" aria-hidden="true" />
            {t('agents.title')}
          </h1>
          {locale !== 'en' && (
            <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
              {t('englishOnly')}
            </p>
          )}
          <p lang="en" className="mt-6 text-lg leading-relaxed text-gray-600">
            An AI agent can join a PairUX session next to the people in it. Each agent uses its own
            CLI process and participant identity. Agents read chat, hear call audio, speak through
            C0mpute TTS, and appear in the participant list with an <strong>Agent</strong> badge.
            Use this to let Claude Code, moshcode or your own script participate directly in a
            pairing call.
          </p>

          <section lang="en" className="mt-12">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <Terminal className="h-6 w-6" aria-hidden="true" /> The pairux command
            </h2>
            <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
              {commands.map((c) => (
                <div
                  key={c.cmd}
                  className="grid gap-2 border-b border-gray-200 p-4 last:border-b-0 sm:grid-cols-2"
                >
                  <code className="text-sm break-all text-gray-900">{c.cmd}</code>
                  <span className="text-sm text-gray-600">{c.what}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-gray-600">
              Add <code>--json</code> to <code>listen</code> or <code>who</code> for one JSON object
              per line, which is the easiest shape for an agent to read. Inside Claude Code the CLI
              names the agent &quot;Claude Code&quot; and tags it <code>claude-code</code> unless
              you pass <code>--name</code> or <code>--client</code>.
            </p>
            <h3 className="mt-8 text-xl font-semibold text-gray-900">Voice setup</h3>
            <p className="mt-3 text-gray-600">
              Voice requires an SFU session and a reachable C0mpute speech gateway. Set up its
              speech workers and run the gateway with a token shared with the CLI. If you are
              providing the compute, start a worker in a separate process:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-950 p-4 text-sm text-gray-100">
              <code>{`c0mpute tts setup --engine all
c0mpute stt setup
c0mpute worker start --roles tts,stt &
export C0MPUTE_SPEECH_TOKEN="$(openssl rand -hex 32)"
c0mpute speech serve &
pairux join ABC123 --name "Claude Code"
pairux voice join --json`}</code>
            </pre>
            <p className="mt-3 text-gray-600">
              The gateway defaults to <code>http://127.0.0.1:8787</code>. Set{' '}
              <code>C0MPUTE_SPEECH_URL</code> if it runs elsewhere. Each agent needs its own CLI
              configuration and must run <code>pairux join</code>; the voice process stays attached
              to that agent until <code>/quit</code> or removal by the host. Write plain text or{' '}
              <code>{'{"say":"Hello"}'}</code> to stdin to speak. With <code>--json</code>, each
              transcript is one JSON line on stdout. Configure <code>C0MPUTE_TTS_ENGINE</code>,{' '}
              <code>C0MPUTE_TTS_VOICE</code> and <code>C0MPUTE_TTS_LOCALE</code> for the voice.{' '}
              C0mpute STT works in audio chunks, so transcripts can arrive several seconds after a
              person speaks. The speech gateway&apos;s default maximum job price is zero; PairUX
              does not fall back to another provider.
            </p>
          </section>

          <section lang="en" className="mt-12">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" /> What an agent can and cannot do
            </h2>
            <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-600">
              <li>It can read the public chat, post in it, and see who is in the session.</li>
              <li>
                In SFU sessions, it can hear call audio and publish speech audio generated by
                C0mpute.
              </li>
              <li>
                It cannot see the shared screen, take remote control, or send direct messages.
              </li>
              <li>
                The host can remove it at any time from the participant list. The agent notices on
                its next poll and stops.
              </li>
              <li>
                Hosts can disable agent joins. Agent processes that stop heartbeating for two
                minutes are treated as gone. A session allows up to 20 agents in addition to its
                human participant allowance.
              </li>
              <li>
                Signing in with <code>pairux login</code> uses OAuth 2.1 with PKCE: you approve the
                CLI in your browser and no password ever reaches the terminal.{' '}
                <code>pairux logout</code> revokes it.
              </li>
            </ul>
          </section>

          <section lang="en" className="mt-12">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <MessageSquare className="h-6 w-6" aria-hidden="true" /> HTTP API
            </h2>
            <p className="mt-4 text-gray-600">
              The CLI is a thin wrapper over the first five routes. Responses are{' '}
              <code>{'{ data }'}</code> or <code>{'{ error }'}</code>. The participant id returned
              by join is the credential for the other agent routes, so keep it private.
            </p>
            <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
              {api.map((a) => (
                <div key={a.route} className="border-b border-gray-200 p-4 last:border-b-0">
                  <code className="text-sm font-semibold break-all text-gray-900">{a.route}</code>
                  <p className="mt-1 text-sm text-gray-600">{a.what}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="mt-12 text-gray-600">
            See also{' '}
            <Link
              href="/use-cases/agentic-pair-programming"
              className="text-primary-600 hover:underline"
            >
              agentic pair programming
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
