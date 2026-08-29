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

  // undici's connect timeout carries no hostname/syscall, only a code and a
  // message, and it is the code most likely to reach a user: apiFetch retries
  // it, so seeing it at all means the retries were already spent.
  it('gives undici connect timeouts friendly text', () => {
    const error = new Error('fetch failed') as Error & {
      cause?: Record<string, unknown>;
    };
    error.cause = {
      code: 'UND_ERR_CONNECT_TIMEOUT',
      message: 'Connect Timeout Error (attempted address: pairux.com:443, timeout: 10000ms)',
    };

    expect(formatNetworkError(error)).toContain('Connection timed out');
    expect(formatNetworkError(error)).toContain('UND_ERR_CONNECT_TIMEOUT');
  });
});
