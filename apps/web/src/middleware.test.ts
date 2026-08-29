import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { CORS_HEADERS } from '@/lib/cors';

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(),
}));

import { updateSession } from '@/lib/supabase/middleware';
import { middleware } from './middleware';

function createNextRequest(url: string, method = 'GET'): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), { method });
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Content-Security-Policy', () => {
    async function cspFor(path: string): Promise<string> {
      const { NextResponse } = await import('next/server');
      vi.mocked(updateSession).mockResolvedValue(NextResponse.next());
      const response = await middleware(createNextRequest(path));
      return response.headers.get('content-security-policy') ?? '';
    }

    function mediaSrc(csp: string): string {
      return csp.split('; ').find((d) => d.startsWith('media-src ')) ?? '';
    }

    // Regression: media-src allowed a remote origin only on /embed/*, so a
    // recording played in the embeddable player but was blocked on the site's
    // own replay pages — a silent, console-only failure.
    it('allows the recording storage origin on replay pages', async () => {
      expect(mediaSrc(await cspFor('/l/TER8XG'))).toContain('supabase');
    });

    it('allows the same media origins on /embed/* as on the site', async () => {
      expect(mediaSrc(await cspFor('/embed/TER8XG'))).toBe(mediaSrc(await cspFor('/l/TER8XG')));
    });

    it('still restricts frame-ancestors off the embed player', async () => {
      expect(await cspFor('/l/TER8XG')).toContain("frame-ancestors 'self' chrome-extension:");
      expect(await cspFor('/embed/TER8XG')).toContain('frame-ancestors *');
    });
  });

  describe('CORS preflight', () => {
    it('returns 204 with CORS headers for OPTIONS on /api/ routes', async () => {
      const request = createNextRequest('/api/sessions/123/signal/stream', 'OPTIONS');
      const response = await middleware(request);

      expect(response.status).toBe(204);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        expect(response.headers.get(key)).toBe(value);
      }
    });

    it('does not call updateSession for OPTIONS preflight', async () => {
      const request = createNextRequest('/api/sessions/123/signal', 'OPTIONS');
      await middleware(request);

      expect(updateSession).not.toHaveBeenCalled();
    });

    it('handles OPTIONS for nested API paths', async () => {
      const request = createNextRequest('/api/chat/stream', 'OPTIONS');
      const response = await middleware(request);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('CORS headers on API responses', () => {
    it('adds CORS headers to API GET responses', async () => {
      const { NextResponse } = await import('next/server');
      const mockResponse = NextResponse.next();
      vi.mocked(updateSession).mockResolvedValue(mockResponse);

      const request = createNextRequest('/api/sessions');
      const response = await middleware(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type, Authorization'
      );
    });

    it('adds CORS headers to API POST responses', async () => {
      const { NextResponse } = await import('next/server');
      const mockResponse = NextResponse.next();
      vi.mocked(updateSession).mockResolvedValue(mockResponse);

      const request = createNextRequest('/api/sessions/123/signal', 'POST');
      const response = await middleware(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('calls updateSession for non-OPTIONS API requests', async () => {
      const { NextResponse } = await import('next/server');
      vi.mocked(updateSession).mockResolvedValue(NextResponse.next());

      const request = createNextRequest('/api/sessions');
      await middleware(request);

      expect(updateSession).toHaveBeenCalledWith(request, expect.any(Headers));
    });
  });

  describe('non-API routes', () => {
    it('does not add CORS headers to non-API routes', async () => {
      const { NextResponse } = await import('next/server');
      const mockResponse = NextResponse.next();
      vi.mocked(updateSession).mockResolvedValue(mockResponse);

      const request = createNextRequest('/dashboard');
      const response = await middleware(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('calls updateSession for non-API routes', async () => {
      const { NextResponse } = await import('next/server');
      vi.mocked(updateSession).mockResolvedValue(NextResponse.next());

      const request = createNextRequest('/dashboard');
      await middleware(request);

      expect(updateSession).toHaveBeenCalledWith(request, expect.any(Headers));
    });
  });
});
