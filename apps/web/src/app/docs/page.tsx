import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import {
  ChevronRight,
  MonitorSmartphone,
  Keyboard,
  Shield,
  Wifi,
  AlertTriangle,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Learn how to use PairUX: installation guides, system requirements, security information, and frequently asked questions.',
};

const tableOfContents = [
  { id: 'getting-started', title: 'Getting Started' },
  { id: 'requirements', title: 'System Requirements' },
  { id: 'hosting', title: 'Hosting a Session' },
  { id: 'viewing', title: 'Viewing a Session' },
  { id: 'control', title: 'Remote Control' },
  { id: 'security', title: 'Security' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
  { id: 'uninstalling', title: 'Uninstalling' },
  { id: 'faq', title: 'FAQ' },
];

const faqs = [
  {
    question: 'Is PairUX free?',
    answer:
      'Yes, PairUX is completely free and open source under the MIT license. There are no premium tiers or paid features.',
  },
  {
    question: 'Do viewers need to install anything?',
    answer:
      "No, viewers can join from any modern browser. The web viewer is a Progressive Web App (PWA) that doesn't require installation, though viewers can optionally install it for quick access.",
  },
  {
    question: 'Is my screen content encrypted?',
    answer:
      'Yes. All media streams are encrypted using WebRTC DTLS-SRTP encryption. The connection is peer-to-peer, meaning your screen data never passes through our servers.',
  },
  {
    question: 'Can I self-host PairUX?',
    answer:
      "Yes. Since PairUX uses WebRTC, the screen sharing happens peer-to-peer. You only need to run your own TURN server for NAT traversal. The signaling can use Supabase's free tier or your own instance.",
  },
  {
    question: 'What happens if I lose connection?',
    answer:
      'PairUX automatically attempts to reconnect. During brief disconnections, viewers will see a reconnecting indicator. For longer outages, viewers may need to rejoin using the same link.',
  },
  {
    question: 'Can multiple viewers join a session?',
    answer:
      'Currently, PairUX supports one viewer per session. Multi-viewer support is planned for a future release.',
  },
  {
    question: 'Does the viewer see my cursor?',
    answer:
      "Yes, your cursor is captured as part of the screen share. When the viewer is granted control, you'll also see their remote cursor as an overlay.",
  },
  {
    question: 'Can I share audio?',
    answer:
      'Audio sharing is on our roadmap but not yet implemented. Currently, PairUX is focused on visual screen sharing and control.',
  },
  {
    question: 'How do I uninstall PairUX?',
    answer:
      'Run "pairux uninstall" to completely remove PairUX, including the desktop app, launcher script, desktop entry, and icon. On macOS, you can also drag PairUX from Applications to the Trash.',
  },
];

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="gradient-bg py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Documentation</h1>
            <p className="mt-4 max-w-2xl text-lg text-gray-600">
              Everything you need to know about using PairUX for collaborative screen sharing.
            </p>
          </div>
        </section>

        {/* Content */}
        <section className="py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="lg:grid lg:grid-cols-12 lg:gap-12">
              {/* Sidebar */}
              <aside className="hidden lg:col-span-3 lg:block">
                <nav className="sticky top-24">
                  <h2 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">
                    On this page
                  </h2>
                  <ul className="mt-4 space-y-2">
                    {tableOfContents.map((item) => (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                        >
                          <ChevronRight className="h-4 w-4" />
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </aside>

              {/* Main content */}
              <div className="lg:col-span-9">
                <div className="prose prose-gray max-w-none">
                  {/* Getting Started */}
                  <section id="getting-started">
                    <h2>Getting Started</h2>
                    <p>
                      PairUX makes it easy to share your screen and collaborate in real-time.
                      Here&apos;s how to get started:
                    </p>
                    <ol>
                      <li>
                        <strong>Download the desktop app</strong> - Visit the{' '}
                        <Link href="/download">download page</Link> and install PairUX on your
                        computer.
                      </li>
                      <li>
                        <strong>Start a session</strong> - Open PairUX and click &quot;Start
                        Session&quot; to begin sharing.
                      </li>
                      <li>
                        <strong>Share the link</strong> - Copy the join link and send it to your
                        collaborator.
                      </li>
                      <li>
                        <strong>Collaborate</strong> - Your viewer can now see your screen and
                        request control.
                      </li>
                    </ol>
                  </section>

                  {/* System Requirements */}
                  <section id="requirements" className="mt-12">
                    <h2>System Requirements</h2>

                    <div className="not-prose my-6 grid gap-4 sm:grid-cols-3">
                      <div className="rounded-lg border border-gray-200 p-4">
                        <h3 className="font-semibold text-gray-900">macOS</h3>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          <li>macOS 12 (Monterey) or later</li>
                          <li>Apple Silicon or Intel</li>
                          <li>Screen Recording permission</li>
                          <li>Accessibility permission (for control)</li>
                        </ul>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-4">
                        <h3 className="font-semibold text-gray-900">Windows</h3>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          <li>Windows 10 (1809) or later</li>
                          <li>x64 or ARM64</li>
                          <li>No special permissions needed</li>
                        </ul>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-4">
                        <h3 className="font-semibold text-gray-900">Linux</h3>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          <li>X11 (recommended) or Wayland</li>
                          <li>x64 architecture</li>
                          <li>PipeWire for screen capture</li>
                        </ul>
                      </div>
                    </div>

                    <h3>Viewer Requirements</h3>
                    <p>Viewers only need a modern web browser. We recommend:</p>
                    <ul>
                      <li>Chrome 90+</li>
                      <li>Firefox 90+</li>
                      <li>Safari 15+</li>
                      <li>Edge 90+</li>
                    </ul>
                  </section>

                  {/* Hosting a Session */}
                  <section id="hosting" className="mt-12">
                    <h2>Hosting a Session</h2>
                    <p>To host a screen sharing session:</p>

                    <div className="not-prose my-6 rounded-lg border border-gray-200 p-6">
                      <div className="flex items-start gap-4">
                        <div className="bg-primary-100 text-primary-600 flex h-10 w-10 items-center justify-center rounded-full">
                          <MonitorSmartphone className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">1. Choose what to share</h3>
                          <p className="mt-1 text-sm text-gray-600">
                            Select your entire screen or a specific application window. The screen
                            picker shows previews of all available sources.
                          </p>
                        </div>
                      </div>
                    </div>

                    <p>
                      Once you start a session, you&apos;ll see your screen being shared with a
                      green border indicator. The session toolbar shows the join link and current
                      viewers.
                    </p>
                  </section>

                  {/* Viewing a Session */}
                  <section id="viewing" className="mt-12">
                    <h2>Viewing a Session</h2>
                    <p>
                      To join a screen sharing session, simply open the join link in your browser.
                      No account or installation is required.
                    </p>
                    <p>
                      The viewer shows the host&apos;s screen in real-time. You can use the toolbar
                      to:
                    </p>
                    <ul>
                      <li>Toggle fullscreen mode</li>
                      <li>Request remote control</li>
                      <li>See connection quality</li>
                      <li>Leave the session</li>
                    </ul>
                  </section>

                  {/* Remote Control */}
                  <section id="control" className="mt-12">
                    <h2>Remote Control</h2>

                    <div className="not-prose my-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-start gap-3">
                        <Keyboard className="h-5 w-5 text-amber-600" />
                        <div className="text-sm">
                          <p className="font-semibold text-amber-800">
                            Control requires host approval
                          </p>
                          <p className="mt-1 text-amber-700">
                            Viewers must request control, and hosts must explicitly approve. Control
                            can be revoked at any time.
                          </p>
                        </div>
                      </div>
                    </div>

                    <h3>How control works</h3>
                    <ol>
                      <li>
                        <strong>Viewer requests control</strong> - Click the control button in the
                        viewer toolbar.
                      </li>
                      <li>
                        <strong>Host approves</strong> - The host sees a notification and can
                        approve or deny.
                      </li>
                      <li>
                        <strong>Control is granted</strong> - The viewer can now use mouse and
                        keyboard.
                      </li>
                      <li>
                        <strong>Simultaneous control</strong> - Both host and viewer can control at
                        the same time.
                      </li>
                    </ol>

                    <h3>Emergency revoke</h3>
                    <p>
                      Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Escape</kbd> at any time to
                      instantly revoke all remote control. This hotkey cannot be overridden.
                    </p>
                  </section>

                  {/* Security */}
                  <section id="security" className="mt-12">
                    <h2>Security</h2>

                    <div className="not-prose my-6 grid gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2">
                          <Shield className="text-accent-600 h-5 w-5" />
                          <h3 className="font-semibold text-gray-900">End-to-End Encryption</h3>
                        </div>
                        <p className="mt-2 text-sm text-gray-600">
                          All media is encrypted using WebRTC DTLS-SRTP. Your screen content never
                          passes through our servers.
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2">
                          <Wifi className="text-accent-600 h-5 w-5" />
                          <h3 className="font-semibold text-gray-900">Peer-to-Peer</h3>
                        </div>
                        <p className="mt-2 text-sm text-gray-600">
                          Connections are established directly between host and viewer using WebRTC.
                        </p>
                      </div>
                    </div>

                    <p>
                      PairUX is designed with security as a core principle. Key security features
                      include:
                    </p>
                    <ul>
                      <li>Explicit consent required for all control</li>
                      <li>Visual indicators when sharing/control is active</li>
                      <li>Emergency revoke hotkey</li>
                      <li>No permanent storage of screen content or input events</li>
                      <li>Open source for full auditability</li>
                    </ul>
                  </section>

                  {/* Troubleshooting */}
                  <section id="troubleshooting" className="mt-12">
                    <h2>Troubleshooting</h2>

                    <div className="not-prose my-6 rounded-lg border border-red-200 bg-red-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        <div className="text-sm">
                          <p className="font-semibold text-red-800">Connection issues?</p>
                          <p className="mt-1 text-red-700">
                            Most connection problems are caused by firewalls or corporate networks.
                            Try using a different network or enabling TURN relay.
                          </p>
                        </div>
                      </div>
                    </div>

                    <h3>Common issues</h3>

                    <h4>Screen Recording permission denied (macOS)</h4>
                    <p>
                      Go to System Preferences → Security & Privacy → Privacy → Screen Recording and
                      enable PairUX.
                    </p>

                    <h4>Viewer cannot connect</h4>
                    <ul>
                      <li>Ensure both parties have a stable internet connection</li>
                      <li>Try disabling VPN if active</li>
                      <li>Check that WebRTC is not blocked by browser extensions</li>
                    </ul>

                    <h4>Poor video quality</h4>
                    <ul>
                      <li>Check your internet upload speed (5+ Mbps recommended)</li>
                      <li>Close bandwidth-heavy applications</li>
                      <li>Try lowering the quality setting in preferences</li>
                    </ul>
                  </section>

                  {/* Uninstalling */}
                  <section id="uninstalling" className="mt-12">
                    <h2>Uninstalling</h2>

                    <h3>Linux</h3>
                    <p>Run the built-in uninstall command to remove everything:</p>
                    <pre>
                      <code>pairux uninstall</code>
                    </pre>
                    <p>This removes the AppImage, launcher script, desktop entry, and icon.</p>
                    <p>To uninstall manually:</p>
                    <pre>
                      <code>{`rm -rf ~/.pairux
rm -f ~/.local/bin/pairux
rm -f ~/.local/share/applications/pairux.desktop
rm -f ~/.local/share/icons/hicolor/256x256/apps/pairux.png`}</code>
                    </pre>

                    <h3>macOS</h3>
                    <p>
                      Drag <strong>PairUX.app</strong> from your Applications folder to the Trash.
                      To also remove the CLI launcher:
                    </p>
                    <pre>
                      <code>rm -f ~/.local/bin/pairux</code>
                    </pre>

                    <h3>Windows</h3>
                    <p>
                      Open <strong>Settings → Apps → Installed apps</strong>, find PairUX, and click{' '}
                      <strong>Uninstall</strong>. Alternatively, run the uninstaller from the Start
                      Menu.
                    </p>
                  </section>

                  {/* FAQ */}
                  <section id="faq" className="mt-12">
                    <h2>Frequently Asked Questions</h2>

                    <div className="not-prose mt-6 space-y-4">
                      {faqs.map((faq) => (
                        <div key={faq.question} className="rounded-lg border border-gray-200 p-4">
                          <h3 className="font-semibold text-gray-900">{faq.question}</h3>
                          <p className="mt-2 text-sm text-gray-600">{faq.answer}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Need help? */}
                  <section className="mt-12">
                    <div className="not-prose rounded-lg bg-gray-50 p-6">
                      <h2 className="text-lg font-semibold text-gray-900">Need more help?</h2>
                      <p className="mt-2 text-gray-600">
                        If you can&apos;t find what you&apos;re looking for, check out our{' '}
                        <Link
                          href="https://github.com/profullstack/pairux.com/discussions"
                          className="text-primary-600 hover:underline"
                        >
                          GitHub Discussions
                        </Link>{' '}
                        or{' '}
                        <Link
                          href="https://github.com/profullstack/pairux.com/issues"
                          className="text-primary-600 hover:underline"
                        >
                          open an issue
                        </Link>
                        .
                      </p>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
