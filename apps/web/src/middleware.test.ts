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
        'GET, POST, PUT, DELETE, OPTIONS'
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

      expect(updateSession).toHaveBeenCalledWith(request);
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

      expect(updateSession).toHaveBeenCalledWith(request);
    });
  });
});
