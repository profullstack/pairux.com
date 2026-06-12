/**
 * fetch with retry for transient network failures.
 *
 * While live streaming, the uplink can saturate enough that new TLS
 * connections to the API time out (undici's UND_ERR_CONNECT_TIMEOUT). Those
 * failures happen before the request is ever sent, so retrying is safe even
 * for POSTs. A couple of short backoff attempts ride out the congestion
 * instead of surfacing "fetch failed" errors in the UI.
 */

const RETRYABLE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function isRetryableNetworkError(error: unknown): boolean {
  let current: unknown = error;
  // Walk the cause chain (undici wraps the real error in TypeError: fetch failed)
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: string }).code;
    if (code && RETRYABLE_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}

const RETRY_DELAYS_MS = [1000, 2500];

export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_DELAYS_MS.length || !isRetryableNetworkError(error)) {
        throw error;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[apiFetch] Network error contacting ${String(input)} (attempt ${String(attempt + 1)}); retrying in ${String(delay)}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
