import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Monitor,
  MousePointer2,
  Users,
  Lock,
  Globe,
  Cpu,
  ArrowRight,
  Video,
  Keyboard,
  Wifi,
  Eye,
  Pointer,
  Shield,
  Check,
  MessageSquare,
  CircleDot,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Explore all the features of PairUX: real-time screen sharing, remote control, multi-cursor collaboration, cross-platform support, and more.',
};

const mainFeatures = [
  {
    icon: Monitor,
    title: 'Real-time Screen Sharing',
    description:
      'Share your entire screen or individual windows with crystal-clear quality. WebRTC-powered streaming delivers low-latency video with adaptive bitrate.',
    details: [
      'Full screen or window sharing',
      '1080p @ 30fps standard quality',
      'Adaptive bitrate for any connection',
      'Cursor included in stream',
    ],
  },
  {
    icon: MousePointer2,
    title: 'Remote Mouse & Keyboard',
    description:
      'Let your collaborator take control with full mouse and keyboard input. All control requires explicit host approval.',
    details: [
      'Full mouse control (click, scroll, drag)',
      'Complete keyboard input',
      'Special keys and shortcuts',
      'Cross-platform compatible',
    ],
  },
  {
    icon: Users,
    title: 'Simultaneous Input',
    description:
      'Both host and viewer can control at the same time. Host input always takes priority for safety and comfort.',
    details: [
      'Both users can control together',
      'Host always has priority',
      'No input blocking or queuing',
      'Visual indicator shows active controller',
    ],
  },
  {
    icon: Lock,
    title: 'Explicit Consent Model',
    description:
      'Security is built in from the ground up. Viewers must request control, and hosts must explicitly approve.',
    details: [
      'Control requests require approval',
      'Emergency revoke hotkey (Ctrl+Shift+Esc)',
      'Visual indicator when control is active',
      'Can revoke control at any time',
    ],
  },
  {
    icon: Globe,
    title: 'PWA Viewer',
    description:
      'Viewers join from any modern browser - no download required. Install as a Progressive Web App for quick access.',
    details: [
      'Works in any modern browser',
      'No account required to join',
      'Installable as PWA',
      'Mobile-friendly for viewing',
    ],
  },
  {
    icon: Cpu,
    title: 'Cross-Platform Desktop',
    description:
      'Native desktop apps for macOS, Windows, and Linux. Install via your favorite package manager.',
    details: [
      'macOS: Homebrew cask',
      'Windows: WinGet',
      'Linux: APT, DNF, AUR',
      'Direct download available',
    ],
  },
  {
    icon: CircleDot,
    title: 'Screen Recording',
    description:
      'Record your sessions locally for later review. Perfect for tutorials, documentation, and keeping a record of pair programming sessions.',
    details: [
      'Record to WebM/MP4 locally',
      'System audio + microphone capture',
      'Quality presets (720p/1080p/4K)',
      'Pause/resume recording',
    ],
    comingSoon: true,
  },
  {
    icon: MessageSquare,
    title: 'Text Chat',
    description:
      'Built-in text chat for when you need to share links, code snippets, or communicate without voice.',
    details: [
      'Real-time messaging',
      'System notifications (join/leave)',
      'Works alongside screen sharing',
      'Message history per session',
    ],
    comingSoon: true,
  },
];

const technicalFeatures = [
  {
    icon: Video,
    title: 'WebRTC P2P',
    description: 'Direct peer-to-peer connection for minimal latency.',
  },
  {
    icon: Shield,
    title: 'E2E Encrypted',
    description: 'DTLS-SRTP encryption for all media streams.',
  },
  {
    icon: Wifi,
    title: 'NAT Traversal',
    description: 'STUN/TURN servers for reliable connectivity.',
  },
  {
    icon: Eye,
    title: 'Adaptive Quality',
    description: 'Automatic quality adjustment based on bandwidth.',
  },
  {
    icon: Pointer,
    title: 'Multi-cursor',
    description: 'See remote cursor position in real-time.',
  },
  {
    icon: Keyboard,
    title: 'Full Keyboard',
    description: 'All keys including modifiers and special keys.',
  },
];

const comparisonFeatures = [
  { feature: 'Screen sharing', pairux: true, others: true },
  { feature: 'Remote control', pairux: true, others: true },
  { feature: 'Simultaneous control', pairux: true, others: false },
  { feature: 'Screen recording (local)', pairux: 'soon', others: 'partial' },
  { feature: 'Text chat', pairux: 'soon', others: true },
  { feature: 'No account for viewers', pairux: true, others: false },
  { feature: 'Open source', pairux: true, others: false },
  { feature: 'Self-hostable', pairux: true, others: false },
  { feature: 'E2E encrypted', pairux: true, others: 'partial' },
  { feature: 'Native apps', pairux: true, others: true },
  { feature: 'Browser viewer', pairux: true, others: false },
  { feature: 'Free tier', pairux: 'unlimited', others: 'limited' },
];

export default function FeaturesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Features
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Everything you need for real-time collaboration, built with privacy and security in
                mind.
              </p>
            </div>
          </div>
        </section>

        {/* Main Features */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-20">
              {mainFeatures.map((feature, index) => (
                <div
                  key={feature.title}
                  className={`grid items-center gap-12 lg:grid-cols-2 ${
                    index % 2 === 1 ? 'lg:flex-row-reverse' : ''
                  }`}
                >
                  <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                    <div className="flex items-center gap-4">
                      <div className="bg-primary-100 text-primary-600 flex h-14 w-14 items-center justify-center rounded-xl">
                        <feature.icon className="h-7 w-7" />
                      </div>
                      {'comingSoon' in feature && feature.comingSoon && (
                        <span className="bg-accent-100 text-accent-700 rounded-full px-3 py-1 text-xs font-medium">
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <h2 className="mt-6 text-3xl font-bold text-gray-900">{feature.title}</h2>
                    <p className="mt-4 text-lg text-gray-600">{feature.description}</p>
                    <ul className="mt-6 space-y-3">
                      {feature.details.map((detail) => (
                        <li key={detail} className="flex items-center gap-3">
                          <Check className="text-accent-600 h-5 w-5" />
                          <span className="text-gray-700">{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    className={`from-primary-100 to-accent-100 aspect-video rounded-2xl bg-gradient-to-br ${
                      index % 2 === 1 ? 'lg:order-1' : ''
                    }`}
                  >
                    <div className="flex h-full items-center justify-center">
                      <feature.icon className="text-primary-400/50 h-24 w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technical Features Grid */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900">Built on Modern Technology</h2>
              <p className="mx-auto mt-4 max-w-2xl text-gray-600">
                PairUX uses industry-standard WebRTC for reliable, low-latency streaming.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {technicalFeatures.map((feature) => (
                <div key={feature.title} className="rounded-xl border border-gray-200 bg-white p-6">
                  <feature.icon className="text-primary-600 h-8 w-8" />
                  <h3 className="mt-4 font-semibold text-gray-900">{feature.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900">How PairUX Compares</h2>
              <p className="mx-auto mt-4 max-w-2xl text-gray-600">
                See how PairUX stacks up against other screen sharing solutions.
              </p>
            </div>

            <div className="mt-12 overflow-x-auto">
              <table className="w-full min-w-[500px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-4 pr-4 text-left font-semibold text-gray-900">Feature</th>
                    <th className="text-primary-600 px-4 py-4 text-center font-semibold">PairUX</th>
                    <th className="px-4 py-4 text-center font-semibold text-gray-500">Others</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((row) => (
                    <tr key={row.feature} className="border-b border-gray-100">
                      <td className="py-4 pr-4 text-gray-700">{row.feature}</td>
                      <td className="px-4 py-4 text-center">
                        {row.pairux === true ? (
                          <Check className="text-accent-600 mx-auto h-5 w-5" />
                        ) : (
                          <span className="text-accent-600 text-sm font-medium">{row.pairux}</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {row.others === true ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : row.others === false ? (
                          <span className="text-gray-300">-</span>
                        ) : (
                          <span className="text-sm text-gray-500">{row.others}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-600 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
              <div className="text-center sm:text-left">
                <h2 className="text-2xl font-bold text-white">Ready to get started?</h2>
                <p className="text-primary-100 mt-1">
                  Download PairUX and start collaborating in seconds.
                </p>
              </div>
              <Link
                href="/download"
                className="text-primary-600 hover:bg-primary-50 flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold transition-colors"
              >
                Download Now
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
