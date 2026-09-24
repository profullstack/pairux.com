import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Mic,
  Presentation,
  ShieldCheck,
  Sparkles,
  Users,
  UserCheck,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'AI Call Analysis: feedback on interviews, team syncs and presentations | PairUX',
  description:
    'Turn on AI call analysis before a PairUX call and get a feedback report afterwards: talk time, speaking pace, filler words, what landed, what to practice, and moments to replay.',
  alternates: { canonical: 'https://pairux.com/features/call-analysis' },
};

const kinds = [
  {
    icon: UserCheck,
    title: 'Interviews',
    body: 'Question by question: how each answer landed, where it ran long or stayed vague, and a stronger way to say it. Interviewing someone else? It reviews your questions and how well you listened.',
  },
  {
    icon: Users,
    title: 'Team syncs',
    body: 'Decisions made, questions left hanging, where the meeting drifted, and every commitment with its owner, so nothing is lost between syncs.',
  },
  {
    icon: Presentation,
    title: 'Presentations and demos',
    body: 'Your opening, through-line and close, where the room was likely lost, and what was on screen: slide density, legibility, and whether the screen matched what you said.',
  },
];

const measured = [
  'Share of talk time for every speaker',
  'Speaking pace in words per minute',
  'Filler words per 100 words, and which ones',
  'Questions asked, longest monologue, interruptions',
];

export default function CallAnalysisFeaturePage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-gradient-to-br from-violet-800 to-indigo-900 py-24 text-white sm:py-32">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="flex items-center gap-2 font-semibold text-violet-200">
              <Sparkles className="h-5 w-5" aria-hidden="true" /> AI call analysis · Pro and Team
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
              Find out how the call really went.
            </h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-violet-100">
              Turn on AI call analysis before your interview, team sync or presentation. When the
              call ends you get a private report: a score, what worked, what to fix, the numbers
              behind it, and the moments worth replaying.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/host"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-violet-800 hover:bg-violet-50"
              >
                Start an analyzed call <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg border border-violet-300 px-6 py-3 font-semibold hover:bg-white/10"
              >
                See plans
              </Link>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">Feedback shaped to the call</h2>
            <div className="mt-10 grid gap-8 lg:grid-cols-3">
              {kinds.map((k) => (
                <article key={k.title} className="rounded-2xl border border-gray-200 p-8">
                  <k.icon className="h-8 w-8 text-violet-600" aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-semibold text-gray-900">{k.title}</h3>
                  <p className="mt-3 leading-relaxed text-gray-600">{k.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-gray-50 py-20">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <BarChart3 className="h-6 w-6 text-violet-600" aria-hidden="true" /> Measured, not
                guessed
              </h2>
              <p className="mt-4 text-gray-600">
                The numbers are counted from the transcript, with each speaker told apart, and the
                written feedback cites them. When the report says you spoke 70% of an interview, it
                is a fact you can check.
              </p>
              <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-700">
                {measured.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <Mic className="h-6 w-6 text-violet-600" aria-hidden="true" /> How it works
              </h2>
              <ol className="mt-4 list-decimal space-y-3 pl-6 text-gray-700">
                <li>
                  Before the call, switch on <strong>AI call analysis</strong> on the start screen
                  (pairux.com, the desktop app or the mobile app) and pick the kind of call.
                  Recording the call turns on with it, and you can turn that off.
                </li>
                <li>
                  During the call, your app uploads the call audio and a still of your shared screen
                  every 20 seconds. Everyone who joins sees that the call is being recorded for
                  analysis.
                </li>
                <li>
                  After the call, the audio is transcribed with speakers told apart and an AI coach
                  writes your report. It arrives by email and lives under Call analyses on your
                  dashboard.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ShieldCheck className="h-6 w-6 text-violet-600" aria-hidden="true" /> Consent and
              privacy
            </h2>
            <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-700">
              <li>
                The choice is made before the call starts and cannot be switched on halfway through.
              </li>
              <li>
                Every participant sees a notice for the whole call, on the web, desktop and mobile
                apps.
              </li>
              <li>
                Reports and recordings are private to the host and can be deleted at any time.
              </li>
              <li>
                Keep the recording off and the audio is deleted as soon as the report is written.
              </li>
              <li>
                On a phone, only your own microphone is recorded; start from pairux.com or the
                desktop app to capture everyone.
              </li>
            </ul>
            <Link
              href="/host"
              className="mt-10 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-700"
            >
              Try it on your next call <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
