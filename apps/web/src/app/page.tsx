import Link from 'next/link';
import {
  Monitor,
  MousePointer2,
  Users,
  Lock,
  Globe,
  Cpu,
  ArrowRight,
  Zap,
  Shield,
  RefreshCw,
  Quote,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { RotatingText } from '@/components/RotatingText';

// Custom GitHub icon SVG component (brand icons deprecated in lucide)
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const features = [
  {
    icon: Monitor,
    title: 'Real-time Screen Sharing',
    description:
      'Low-latency WebRTC streaming delivers crystal-clear screen sharing with adaptive quality.',
  },
  {
    icon: MousePointer2,
    title: 'Remote Control',
    description:
      'Mouse and keyboard control with explicit host approval. Both can control simultaneously.',
  },
  {
    icon: Users,
    title: 'Simultaneous Input',
    description:
      'Host and viewer can control at the same time. Host always has priority for safety.',
  },
  {
    icon: Lock,
    title: 'Secure by Design',
    description: 'End-to-end encrypted via WebRTC DTLS-SRTP. Media never touches our servers.',
  },
  {
    icon: Globe,
    title: 'PWA Viewer',
    description: 'Join sessions from any browser. No downloads required for viewers.',
  },
  {
    icon: Cpu,
    title: 'Cross-platform',
    description:
      'Desktop apps for macOS, Windows, and Linux. Install via Homebrew, WinGet, or APT.',
  },
];

const steps = [
  {
    number: '1',
    title: 'Install the Desktop App',
    description: 'Download PairUX on your computer via your package manager or direct download.',
  },
  {
    number: '2',
    title: 'Start a Session',
    description: 'Click "Start Session" and choose which screen or window to share.',
  },
  {
    number: '3',
    title: 'Share the Link',
    description: 'Send the join link to your collaborator. They can join from any browser.',
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="gradient-bg relative overflow-hidden">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-36">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                Pair <RotatingText />, <span className="gradient-text">reimagined</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 sm:text-xl">
                Collaborative screen sharing with simultaneous remote mouse and keyboard control.
                Like Screenhero, but open source.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  href="/download"
                  className="bg-primary-600 hover:bg-primary-700 flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl"
                >
                  Download for Free
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="https://github.com/profullstack/pairux.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-900 shadow transition-all hover:border-gray-400 hover:shadow-md"
                >
                  <GitHubIcon className="h-5 w-5" />
                  View on GitHub
                </Link>
              </div>
              <p className="mt-6 text-sm text-gray-500">
                Free and open source. No account required for viewers.
              </p>
            </div>
          </div>

          {/* Decorative background elements */}
          <div className="bg-primary-100/50 absolute -top-40 -right-40 h-80 w-80 rounded-full blur-3xl" />
          <div className="bg-accent-100/50 absolute -bottom-40 -left-40 h-80 w-80 rounded-full blur-3xl" />
        </section>

        {/* Features Grid */}
        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Everything you need for remote collaboration
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Built for developers, designers, and anyone who needs to work together in real-time.
              </p>
            </div>

            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="group hover:border-primary-200 relative rounded-2xl border border-gray-200 bg-white p-8 transition-all hover:shadow-lg"
                >
                  <div className="bg-primary-100 text-primary-600 group-hover:bg-primary-600 flex h-12 w-12 items-center justify-center rounded-xl transition-colors group-hover:text-white">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-gray-900">{feature.title}</h3>
                  <p className="mt-2 text-gray-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="bg-gray-50 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Get started in minutes
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                No complicated setup. Just install, share, and collaborate.
              </p>
            </div>

            <div className="mt-16 grid gap-8 lg:grid-cols-3">
              {steps.map((step, index) => (
                <div key={step.number} className="relative">
                  {/* Connector line */}
                  {index < steps.length - 1 && (
                    <div className="bg-primary-200 absolute top-16 left-1/2 hidden h-0.5 w-full lg:block" />
                  )}
                  <div className="relative flex flex-col items-center text-center">
                    <div className="bg-primary-600 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg">
                      {step.number}
                    </div>
                    <h3 className="mt-6 text-xl font-semibold text-gray-900">{step.title}</h3>
                    <p className="mt-2 max-w-xs text-gray-600">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Social Proof / Testimonials */}
        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Loved by developers and executives
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                ...and everyone in between. See what others are saying about PairUX.
              </p>
            </div>

            <div className="mt-16 grid gap-8 md:grid-cols-3">
              {/* Testimonial placeholders */}
              {[
                {
                  quote:
                    'Finally, a Screenhero replacement that actually works. The simultaneous control feature is game-changing for pair programming.',
                  author: 'Coming Soon',
                  role: 'Software Engineer',
                },
                {
                  quote:
                    'The fact that viewers can join from any browser without installing anything makes this perfect for quick collaboration sessions.',
                  author: 'Coming Soon',
                  role: 'Tech Lead',
                },
                {
                  quote:
                    'Open source, end-to-end encrypted, and it just works. This is exactly what the developer community needed.',
                  author: 'Coming Soon',
                  role: 'Open Source Contributor',
                },
              ].map((testimonial, index) => (
                <div
                  key={index}
                  className="relative rounded-2xl border border-gray-200 bg-gray-50 p-8"
                >
                  <Quote className="text-primary-200 absolute top-6 right-6 h-8 w-8" />
                  <p className="text-gray-700 italic">&ldquo;{testimonial.quote}&rdquo;</p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="bg-primary-200 h-10 w-10 rounded-full" />
                    <div>
                      <p className="font-semibold text-gray-900">{testimonial.author}</p>
                      <p className="text-sm text-gray-500">{testimonial.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 text-center text-sm text-gray-500">
              Want to share your experience?{' '}
              <Link
                href="https://github.com/profullstack/pairux.com/discussions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                Join the discussion on GitHub
              </Link>
            </p>
          </div>
        </section>

        {/* Security Section */}
        <section className="bg-gray-50 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                  Security you can trust
                </h2>
                <p className="mt-4 text-lg text-gray-600">
                  PairUX is built with security at its core. Your screen data never touches our
                  servers.
                </p>

                <ul className="mt-8 space-y-4">
                  <li className="flex items-start gap-3">
                    <Shield className="text-accent-600 mt-0.5 h-6 w-6 flex-shrink-0" />
                    <div>
                      <strong className="font-semibold text-gray-900">End-to-End Encryption</strong>
                      <p className="text-gray-600">All media encrypted via WebRTC DTLS-SRTP</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <Lock className="text-accent-600 mt-0.5 h-6 w-6 flex-shrink-0" />
                    <div>
                      <strong className="font-semibold text-gray-900">Explicit Consent</strong>
                      <p className="text-gray-600">Host must approve all control requests</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <Zap className="text-accent-600 mt-0.5 h-6 w-6 flex-shrink-0" />
                    <div>
                      <strong className="font-semibold text-gray-900">Emergency Revoke</strong>
                      <p className="text-gray-600">
                        Ctrl+Shift+Escape instantly revokes all control
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <RefreshCw className="text-accent-600 mt-0.5 h-6 w-6 flex-shrink-0" />
                    <div>
                      <strong className="font-semibold text-gray-900">Open Source</strong>
                      <p className="text-gray-600">Fully auditable code under MIT license</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Placeholder for security diagram/illustration */}
              <div className="relative">
                <div className="from-primary-100 to-accent-100 aspect-square rounded-2xl bg-gradient-to-br p-8">
                  <div className="border-primary-300 flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white/50">
                    <Lock className="text-primary-600 h-16 w-16" />
                    <p className="mt-4 text-center text-sm text-gray-600">
                      Direct peer-to-peer connection
                      <br />
                      No server-side media storage
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-primary-600 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Ready to collaborate?
              </h2>
              <p className="text-primary-100 mx-auto mt-4 max-w-2xl text-lg">
                Download PairUX and start sharing your screen in seconds. Free, open source, and
                privacy-focused.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  href="/download"
                  className="text-primary-600 hover:bg-primary-50 flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold shadow-lg transition-all hover:shadow-xl"
                >
                  Download Now
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="/features"
                  className="border-primary-400 hover:bg-primary-500 flex items-center gap-2 rounded-lg border px-6 py-3 text-base font-semibold text-white transition-all"
                >
                  Learn More
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
