import { describe, expect, it } from 'vitest';
import { formatNetworkError } from './network-error';

describe('formatNetworkError', () => {
  it('returns original message for non-fetch errors', () => {
    expect(formatNetworkError(new Error('Network error'))).toBe('Network error');
  });

  it('adds cause details for fetch failed', () => {
    const error = new Error('fetch failed') as Error & {
      cause?: Record<string, unknown>;
    };
    error.cause = {
      code: 'ENOTFOUND',
      syscall: 'getaddrinfo',
      hostname: 'pairux.com',
    };

    expect(formatNetworkError(error)).toContain('fetch failed');
    expect(formatNetworkError(error)).toContain('DNS lookup failed');
    expect(formatNetworkError(error)).toContain('ENOTFOUND');
  });
});
