import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import { PWAInstallButton } from '@/components/pwa';
import './globals.css';

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
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com'),
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
        url: '/banner.png',
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
    images: ['/banner.png'],
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
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon-180x180.png', sizes: '180x180' },
      { url: '/icons/apple-touch-icon-152x152.png', sizes: '152x152' },
      { url: '/icons/apple-touch-icon-144x144.png', sizes: '144x144' },
      { url: '/icons/apple-touch-icon-120x120.png', sizes: '120x120' },
    ],
    other: [{ rel: 'msapplication-TileImage', url: '/icons/apple-touch-icon-144x144.png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PairUX',
  },
  other: {
    'msapplication-TileColor': '#0f172a',
    'msapplication-config': '/icons/browserconfig.xml',
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

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'PairUX',
  url: 'https://pairux.com',
  logo: 'https://pairux.com/logo.svg',
  description:
    'Real-time screen sharing with simultaneous remote mouse and keyboard control. Like Screenhero, but open source.',
  email: 'hello@pairux.com',
  legalName: 'Profullstack, Inc.',
  sameAs: [
    'https://github.com/profullstack/pairux.com',
    'https://x.com/profullstackinc',
    'https://discord.gg/U7dEXfBA3s',
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        {children}
        <PWAInstallButton />
        {/* Datafast Analytics */}
        <Script
          defer
          nonce={nonce}
          src="https://datafa.st/js/script.js"
          data-website-id="dfid_tUrFgv4cjOcfrfM3ofldI"
          data-domain="pairux.com"
          strategy="afterInteractive"
        />
        <Script
          nonce={nonce}
          data-site="77cf2148-c41b-47af-8326-ab4676fa0b81"
          src="https://crawlproof.com/stats.js"
          strategy="afterInteractive"
        />
        <script
          async
          nonce={nonce}
          src="https://feedback.profullstack.com/embed/profullstack-feedback.js"
          data-property="pairux.com"
        ></script>
      </body>
    </html>
  );
}
