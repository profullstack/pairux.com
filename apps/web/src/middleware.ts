import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { CORS_HEADERS } from '@/lib/cors';

// Content-Security-Policy is built per-request here (not in next.config) so it
// can carry a fresh script nonce — that lets us drop 'unsafe-inline' from
// script-src. Next.js reads the nonce from the request's CSP header and applies
// it to its inline bootstrap scripts; our own inline <script>s read x-nonce.
function buildCsp(nonce: string, embeddable: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://crawlproof.com https://datafa.st https://feedback.profullstack.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    // The embeddable player streams recordings from Supabase Storage over https.
    embeddable ? "media-src 'self' blob: https:" : "media-src 'self' blob:",
    "connect-src 'self' https: wss: https://crawlproof.com",
    // /embed/* is the public player — any site may frame it. That is the whole
    // point of the surface, and it is safe because the page is read-only: it
    // renders a <video> plus outbound links, and performs no authenticated
    // action, so there is nothing for a framing site to clickjack. Every other
    // path keeps the restrictive list.
    embeddable ? 'frame-ancestors *' : "frame-ancestors 'self' chrome-extension:",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isEmbed = pathname === '/embed' || pathname.startsWith('/embed/');

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, isEmbed);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  // Lets the root layout drop chrome (analytics, feedback widget, PWA prompt)
  // that has no business rendering inside someone else's page.
  if (isEmbed) requestHeaders.set('x-embed', '1');

  // Vanity channel URL: pairux.com/@handle serves the channel page (/c/handle).
  const vanity = /^\/@([A-Za-z0-9_]{3,30})$/.exec(pathname);
  if (vanity) {
    const url = request.nextUrl.clone();
    url.pathname = `/c/${vanity[1] ?? ''}`;
    const rewrite = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    rewrite.headers.set('content-security-policy', csp);
    return rewrite;
  }

  // Handle CORS preflight for API routes (desktop app uses file:// origin)
  if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  const response = await updateSession(request, requestHeaders);
  response.headers.set('content-security-policy', csp);

  // Add CORS headers for API routes
  if (pathname.startsWith('/api/')) {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
