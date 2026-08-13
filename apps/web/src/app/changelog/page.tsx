import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'See what&apos;s new in PairUX. Release notes and version history.',
  alternates: { canonical: 'https://pairux.com/changelog' },
};

const releases = [
  {
    version: '0.9.74',
    date: 'August 2026',
    title: 'Reliable guest pointer capture',
    changes: [
      'Guest pointer lock is now requested directly from the trusted pointer gesture after focusing the shared display',
      'The guest cursor is hidden only after pointer lock is confirmed, preventing a failed lock from looking like a stuck virtual cursor',
      'A visible retry prompt and guest-side pointer-lock logs make a refused capture recoverable and diagnosable',
    ],
  },
  {
    version: '0.9.73',
    date: 'August 2026',
    title: 'Reliable shared-pointer control handoff',
    changes: [
      'A guest is granted control only after the host input backend is ready, including KDE portal approval',
      'Only the approved guest can send ordered input; stale and replayed input is rejected before it reaches the host cursor',
      'Revoking control now stops local input before notifying the guest, releasing the host pointer immediately',
      'Wayland guidance now directs hosts to the supported portal path instead of suggesting automatic ydotool setup',
    ],
  },
  {
    version: '0.9.72',
    date: 'August 2026',
    title: 'Wayland desktop startup repair',
    changes: [
      'Fixed the Linux AppImage startup failure caused by an optional legacy X11 module in the portal dependency',
      'The KDE/Wayland RemoteDesktop portal path now starts without X11 installed',
    ],
  },
  {
    version: '0.9.71',
    date: 'August 2026',
    title: 'KDE/Wayland host-approved remote control',
    changes: [
      'KDE/Wayland remote input now uses the XDG RemoteDesktop portal instead of raw ydotool injection',
      'KDE must approve a short-lived control session before a guest can send input',
      'Revoking control or using the emergency stop closes the portal session and releases held input',
      'The portal relative-pointer path positions the shared pointer before clicks and scrolling',
    ],
  },
  {
    version: '0.9.70',
    date: 'August 2026',
    title: 'One shared host pointer for remote control',
    changes: [
      'Remote input now drives the host’s one real system pointer directly',
      'Host and guest can take turns naturally whenever the other is idle',
      'Removed the overlay cursor, cursor-position transport, pointer borrowing, restoration, and KDE cursor helper',
      'The host can always stop remote input with Ctrl+Shift+Escape',
    ],
  },
  {
    version: '0.1.0',
    date: 'January 2025',
    title: 'Initial Release',
    changes: [
      'Screen sharing with remote control',
      'P2P WebRTC connections',
      'Cross-platform desktop apps (macOS, Windows, Linux)',
      'Browser-based viewer (no install required)',
      'End-to-end encryption',
      'Simultaneous input control',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Changelog
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                See what&apos;s new in PairUX
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-12">
              {releases.map((release) => (
                <div key={release.version} className="border-primary-500 border-l-2 pl-6">
                  <div className="flex items-center gap-3">
                    <span className="bg-primary-100 text-primary-700 rounded-full px-3 py-1 text-sm font-semibold">
                      v{release.version}
                    </span>
                    <span className="text-sm text-gray-500">{release.date}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-bold text-gray-900">{release.title}</h2>
                  <ul className="mt-4 space-y-2">
                    {release.changes.map((change, i) => (
                      <li key={i} className="text-gray-600">
                        • {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
