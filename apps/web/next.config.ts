import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Enable Turbopack (Next.js 16+ default)
  turbopack: {},

  // Standalone output for Docker deployment
  output: 'standalone',

  // Transpile shared packages
  transpilePackages: ['@pairux/shared-types'],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },

  // Headers for security
  headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options intentionally omitted so PairUX can be embedded as
          // an iframe inside the TronBrowser extension (Chat → PairUX tab).
          // Framing is governed by the CSP frame-ancestors directive below.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://crawlproof.com https://datafa.st; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: wss: https://crawlproof.com; frame-ancestors *; base-uri 'self'; form-action 'self';",
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=(self)',
          },
        ],
      },
    ];
  },

  // Redirects
  redirects() {
    return [
      {
        source: '/github',
        destination: 'https://github.com/profullstack/pairux.com',
        permanent: false,
      },
    ];
  },
};

export default withSerwist(nextConfig);
