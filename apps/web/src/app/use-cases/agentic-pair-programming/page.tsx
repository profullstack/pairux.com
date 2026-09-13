import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Terminal, Users, Monitor } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Agentic Pair Programming with moshcode | PairUX',
  description:
    'Work with a teammate in the same live coding-agent session. Use moshcode for a shared terminal and PairUX to review the screen and app together.',
  alternates: { canonical: 'https://pairux.com/use-cases/agentic-pair-programming' },
};

const steps = [
  {
    icon: Terminal,
    title: 'Start with one live session',
    body: 'Run moshcode on your development machine and open its session at app.moshcode.sh. You and your teammate follow the same agent output and work in the same terminal.',
  },
  {
    icon: Users,
    title: 'Bring your team into the session',
    body: 'Create an organization and team in moshcode, add your teammate using their account email, then share the session with that team. Read access lets them watch; writer access lets them send input to the running session.',
  },
  {
    icon: Monitor,
    title: 'Review the result together in PairUX',
    body: 'Share your terminal, editor, or app preview with PairUX. Your teammate joins from a browser to see the work in context. Approve remote control when you want them to use your mouse and keyboard too.',
  },
];

export default function AgenticPairProgrammingPage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-gray-900 py-24 text-white sm:py-32">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/use-cases"
              className="mb-8 inline-block text-sm text-gray-300 hover:text-white"
            >
              ← All use cases
            </Link>
            <p className="text-primary-300 font-semibold">Agentic pair programming</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
              Two people. One agent session.
            </h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-gray-300">
              Pair programming still needs shared context when an AI agent writes the code. Bring a
              teammate into your live moshcode session, then use PairUX to review what the agent
              builds and decide the next step together.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="https://app.moshcode.sh/"
                className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold"
              >
                Open moshcode <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
              <Link
                href="/download"
                className="rounded-lg border border-gray-600 px-6 py-3 font-semibold hover:bg-gray-800"
              >
                Get PairUX
              </Link>
            </div>
          </div>
        </section>
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">From watching to working together</h2>
            <div className="mt-12 grid gap-8 lg:grid-cols-3">
              {steps.map((step, index) => (
                <article key={step.title} className="rounded-2xl border border-gray-200 p-8">
                  <step.icon className="text-primary-600 h-8 w-8" aria-hidden="true" />
                  <h3 className="mt-6 text-xl font-semibold text-gray-900">
                    {index + 1}. {step.title}
                  </h3>
                  <p className="mt-4 leading-relaxed text-gray-600">{step.body}</p>
                </article>
              ))}
            </div>
            <p className="mt-8 max-w-3xl text-gray-600">
              moshcode team permissions govern access to the terminal session. PairUX remote control
              is a separate choice that the screen-sharing host approves. Use either or both,
              depending on how you want to collaborate.
            </p>
          </div>
        </section>
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">
              A practical way to onboard a contractor
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Add a contractor to your team and let them watch your first session with read access.
              Walk through the task, the agent’s output, and the running app. When they are ready to
              participate, grant writer access so they can work with you in that same session.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-gray-600">
              You can also use this workflow to investigate a failing test, compare an agent’s
              implementation with the intended behavior, or review a change before merging it.
              Everyone sees the work as it happens.
            </p>
            <Link
              href="/download"
              className="text-primary-600 hover:text-primary-700 mt-8 inline-flex items-center gap-2 font-semibold"
            >
              Start pairing with PairUX <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
