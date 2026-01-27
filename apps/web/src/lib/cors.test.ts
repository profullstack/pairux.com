import { describe, it, expect } from 'vitest';
import { CORS_HEADERS } from './cors';

describe('CORS_HEADERS', () => {
  it('includes Access-Control-Allow-Origin wildcard', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
  });

  it('includes allowed methods', () => {
    const methods = CORS_HEADERS['Access-Control-Allow-Methods'];
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('PUT');
    expect(methods).toContain('DELETE');
    expect(methods).toContain('OPTIONS');
  });

  it('includes allowed headers for Content-Type and Authorization', () => {
    const headers = CORS_HEADERS['Access-Control-Allow-Headers'];
    expect(headers).toContain('Content-Type');
    expect(headers).toContain('Authorization');
  });

  it('includes Max-Age for preflight caching', () => {
    expect(CORS_HEADERS['Access-Control-Max-Age']).toBe('86400');
  });
});
