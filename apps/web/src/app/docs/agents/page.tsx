import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, Terminal, ShieldCheck, MessageSquare } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Agent participants | PairUX Docs',
  description:
    'Bring an AI agent such as Claude Code into a live PairUX session. It joins with the join code, follows the chat, answers in it, and shows up labelled as an agent on web, desktop and mobile.',
  alternates: { canonical: 'https://pairux.com/docs/agents' },
};

const commands: { cmd: string; what: string }[] = [
  {
    cmd: 'curl -fsSL https://installer.pairux.com/install.sh | bash',
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
  { route: 'DELETE /api/v1/agents/:participantId', what: 'Leave the session.' },
];

export default function AgentDocsPage() {
  return (
    <>
      <Header />
      <main className="py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Link href="/docs" className="text-primary-600 text-sm hover:underline">
            ← Documentation
          </Link>
          <h1 className="mt-6 flex items-center gap-3 text-4xl font-bold tracking-tight text-gray-900">
            <Bot className="text-primary-600 h-9 w-9" aria-hidden="true" />
            Agent participants
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-gray-600">
            An AI agent can join a PairUX session next to the people in it. It uses the same join
            code as everyone else, reads the chat, answers in it, and appears in the participant
            list with an <strong>Agent</strong> badge in the browser, the installed web app, the
            desktop app and the mobile app. Use it to let Claude Code, moshcode or your own script
            follow a pairing session and report back while you work.
          </p>

          <section className="mt-12">
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
          </section>

          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" /> What an agent can and cannot do
            </h2>
            <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-600">
              <li>It can read the public chat, post in it, and see who is in the session.</li>
              <li>
                It cannot see or hear the shared screen, take remote control, or send direct
                messages.
              </li>
              <li>
                The host can remove it at any time from the participant list. The agent notices on
                its next poll and stops.
              </li>
              <li>
                A session holds at most 5 agents. An agent that stops polling for two minutes is
                treated as gone.
              </li>
              <li>
                Signing in with <code>pairux login</code> uses OAuth 2.1 with PKCE: you approve the
                CLI in your browser and no password ever reaches the terminal.{' '}
                <code>pairux logout</code> revokes it.
              </li>
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <MessageSquare className="h-6 w-6" aria-hidden="true" /> HTTP API
            </h2>
            <p className="mt-4 text-gray-600">
              The CLI is a thin wrapper over four routes. Responses are <code>{'{ data }'}</code> or{' '}
              <code>{'{ error }'}</code>. The participant id returned by join is the credential for
              the other three, so keep it private.
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
