import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { CORS_HEADERS } from '@/lib/cors';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Vanity channel URL: pairux.com/@handle serves the channel page (/c/handle).
  const vanity = /^\/@([A-Za-z0-9_]{3,30})$/.exec(pathname);
  if (vanity) {
    const url = request.nextUrl.clone();
    url.pathname = `/c/${vanity[1] ?? ''}`;
    return NextResponse.rewrite(url);
  }

  // Handle CORS preflight for API routes (desktop app uses file:// origin)
  if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  const response = await updateSession(request);

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
