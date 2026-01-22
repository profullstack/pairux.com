import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'PairUX - Collaborative Screen Sharing with Remote Control',
    template: '%s | PairUX',
  },
  description:
    'Real-time screen sharing with simultaneous remote mouse and keyboard control. Like Screenhero, but open source. Available for macOS, Windows, and Linux.',
  keywords: [
    'screen sharing',
    'remote control',
    'pair programming',
    'collaboration',
    'webrtc',
    'electron',
    'open source',
  ],
  authors: [{ name: 'PairUX Team' }],
  creator: 'PairUX',
  publisher: 'PairUX',
  formatDetection: {
    email: false,
    telephone: false,
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com'
  ),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://pairux.com',
    siteName: 'PairUX',
    title: 'PairUX - Collaborative Screen Sharing with Remote Control',
    description:
      'Real-time screen sharing with simultaneous remote mouse and keyboard control. Like Screenhero, but open source.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PairUX - Collaborative Screen Sharing',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PairUX - Collaborative Screen Sharing with Remote Control',
    description:
      'Real-time screen sharing with simultaneous remote mouse and keyboard control. Like Screenhero, but open source.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans">
        {children}
      </body>
    </html>
  );
}
