interface FetchCause {
  code?: string;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
  message?: string;
}

// Codes apiFetch retries only reach a user once those retries are spent, so
// each one needs text worth reading. UND_ERR_HEADERS_TIMEOUT is not retried —
// the request was already sent, so a POST can't be replayed safely — but it
// surfaces the same way, so it is spelled out here too.
const FRIENDLY_CODES: Record<string, string> = {
  ENOTFOUND: 'DNS lookup failed',
  EAI_AGAIN: 'DNS lookup timed out',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset',
  ETIMEDOUT: 'Connection timed out',
  ENETUNREACH: 'Network unreachable',
  EHOSTUNREACH: 'Host unreachable',
  UND_ERR_CONNECT_TIMEOUT: 'Connection timed out',
  UND_ERR_HEADERS_TIMEOUT: 'Server took too long to respond',
  UND_ERR_SOCKET: 'Connection closed unexpectedly',
  CERT_HAS_EXPIRED: 'TLS certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate verification failed',
};

function formatFetchCause(cause: FetchCause): string | null {
  const code = cause.code;
  const friendly = code ? FRIENDLY_CODES[code] : undefined;

  const location = cause.hostname
    ? `${cause.hostname}${cause.port ? `:${String(cause.port)}` : ''}`
    : cause.address
      ? `${cause.address}${cause.port ? `:${String(cause.port)}` : ''}`
      : null;

  const parts = [
    friendly ?? null,
    code ?? null,
    cause.syscall ?? null,
    location,
    cause.message && cause.message !== 'fetch failed' ? cause.message : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

export function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Network error';
  }

  if (error.message !== 'fetch failed') {
    return error.message;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const details = formatFetchCause(cause as FetchCause);
    if (details) {
      return `fetch failed (${details})`;
    }
  }

  return 'fetch failed';
}
