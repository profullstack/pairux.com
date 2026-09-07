/**
 * Access-token lifecycle for the mobile app.
 *
 * Mobile port of the desktop refresh flow in
 * apps/desktop/src/main/auth/secure-storage.ts: a single-flight
 * POST /api/auth/refresh with the stored refresh token, converting the
 * Supabase `expires_at` seconds to the millisecond timestamps kept in
 * secure storage.
 *
 * Unlike desktop's synchronous safeStorage, expo-secure-store writes are
 * async, so every token mutation is serialized through one queue and only
 * committed while the session epoch it started under is still current. The
 * epoch advances on logout and on every completed login, which makes the
 * outcome of overlapping refreshes, logins, and logouts deterministic: a
 * slow refresh can neither overwrite a newer account's tokens nor resurrect
 * a session the user just signed out of.
 */
import { API_BASE_URL } from '../config';
import {
  storeAuth,
  getStoredAuth,
  clearStoredAuth,
  isAuthExpired,
  type StoredAuth,
} from './secure-storage';

// ── Session epoch + serialized storage mutations ──────────────────

let sessionEpoch = 0;
// Fail closed for this process if native deletion fails. This cannot guarantee
// deletion across an app restart when the OS secure store itself is unavailable.
let storedSessionBlocked = false;

// Every secure-store mutation runs through this queue so an in-flight native
// write can never land after (and silently undo) a logout's delete.
let mutationQueue: Promise<unknown> = Promise.resolve();

function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Invalidate older login attempts before starting a new one. */
export function beginAuthMutation(): number {
  return ++sessionEpoch;
}

/**
 * Clears stored tokens. The epoch bump is synchronous, so refreshes and
 * logins already in flight are invalidated before this resolves — even when
 * one of them is mid-way through a native secure-store write.
 */
export async function clearAuthSession(): Promise<void> {
  await endAuthSession();
}

/** Capture only the outgoing session for revocation, then delete it atomically. */
export async function endAuthSession(): Promise<StoredAuth | null> {
  const epoch = ++sessionEpoch;
  storedSessionBlocked = true;
  return enqueueMutation(async () => {
    let previous: StoredAuth | null = null;
    try {
      previous = await getStoredAuth();
    } catch {
      // A failed read must not prevent local deletion.
    }
    await clearStoredAuth();
    if (sessionEpoch === epoch) storedSessionBlocked = false;
    return previous;
  });
}

/**
 * Persist a fresh login's session. Returns false (storing nothing that
 * survives) when a logout or a newer login won the race. On success the
 * epoch advances, so refreshes and older logins still in flight for the
 * previous session are discarded when they eventually resolve.
 */
export async function commitLoginSession(auth: StoredAuth, startedEpoch: number): Promise<boolean> {
  return enqueueMutation(async () => {
    if (sessionEpoch !== startedEpoch) return false;
    await storeAuth(auth);
    if (sessionEpoch !== startedEpoch) {
      // A newer login may fail without writing or deleting anything. Remove
      // this superseded login inside the queue before any newer writer runs.
      const cleanupEpoch = sessionEpoch;
      storedSessionBlocked = true;
      await clearStoredAuth();
      if (sessionEpoch === cleanupEpoch) storedSessionBlocked = false;
      return false;
    }
    sessionEpoch += 1;
    storedSessionBlocked = false;
    return true;
  });
}

// ── Server envelope validation ────────────────────────────────────

export interface SessionEnvelope {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since epoch (converted from the server's seconds). */
  expiresAt: number;
}

/**
 * Validate a login/refresh `session` payload. Returns null unless both
 * tokens are non-empty strings and `expiresAt` is a positive finite number
 * of seconds. Supabase types `expires_at` as optional, so a proxy or server
 * change can omit it — storing the resulting NaN would create a token that
 * never counts as expired and therefore never refreshes.
 */
export function parseSessionEnvelope(session: unknown): SessionEnvelope | null {
  if (typeof session !== 'object' || session === null) return null;
  const { accessToken, refreshToken, expiresAt } = session as Record<string, unknown>;
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) return null;
  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  const expiresAtMs = expiresAt * 1000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs > 8640000000000000) return null;
  return { accessToken, refreshToken, expiresAt: expiresAtMs };
}

// ── Single-flight refresh ─────────────────────────────────────────

export type RefreshFailure =
  /** No stored refresh token — the user is signed out. */
  | 'signed-out'
  /** The server definitively refused the refresh token (4xx). */
  | 'rejected'
  /** Network/server error or malformed payload — the token may still work. */
  | 'transient'
  /** A login or logout completed while this refresh was in flight. */
  | 'superseded';

export interface RefreshResult {
  auth: StoredAuth | null;
  failure?: RefreshFailure;
}

let refreshInFlight: { epoch: number; promise: Promise<RefreshResult> } | null = null;

/**
 * Refresh the access token using the stored refresh token. Concurrent calls
 * within one session epoch share a single request; after a login or logout
 * the stale in-flight promise is never handed out, so a caller for the new
 * account starts a fresh refresh instead of receiving the old account's
 * (discarded) outcome.
 */
export async function refreshAuthSession(): Promise<RefreshResult> {
  if (refreshInFlight?.epoch === sessionEpoch) {
    return refreshInFlight.promise;
  }

  const entry = { epoch: sessionEpoch, promise: runRefresh(sessionEpoch) };
  refreshInFlight = entry;
  try {
    return await entry.promise;
  } finally {
    // Only retire our own entry: a newer epoch's refresh may already be here.
    if (refreshInFlight === entry) {
      refreshInFlight = null;
    }
  }
}

async function runRefresh(startedEpoch: number): Promise<RefreshResult> {
  const failureResult = (failure: RefreshFailure): RefreshResult => ({
    auth: null,
    failure: sessionEpoch === startedEpoch ? failure : 'superseded',
  });
  const stored = await readAuthSession();
  if (sessionEpoch !== startedEpoch) return failureResult('superseded');
  if (!stored?.refreshToken) {
    return { auth: null, failure: 'signed-out' };
  }

  let session: SessionEnvelope | null = null;
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });

    if (!response.ok) {
      console.error('[Auth] Token refresh failed:', response.status);
      // The refresh route returns 400/401 for a missing or rejected token.
      // Rate limits/timeouts (429/408) must not destroy a recoverable session.
      return failureResult(
        response.status === 400 || response.status === 401 ? 'rejected' : 'transient'
      );
    }

    const result = (await response.json()) as { data?: { session?: unknown } };
    session = parseSessionEnvelope(result.data?.session);
  } catch (error) {
    console.error('[Auth] Token refresh error:', error);
    return failureResult('transient');
  }

  if (!session) {
    console.error('[Auth] Token refresh returned an invalid session payload');
    return failureResult('transient');
  }

  const updated: StoredAuth = { ...session, user: stored.user };

  try {
    const committed = await enqueueMutation(async () => {
      // A logout/login during the request wins: discard the refreshed tokens.
      if (sessionEpoch !== startedEpoch) return false;
      await storeAuth(updated);
      // Re-check: a logout may have arrived while the native write ran; its
      // queued delete (behind us in the queue) removes what we just wrote.
      return sessionEpoch === startedEpoch;
    });
    if (!committed) {
      return { auth: null, failure: 'superseded' };
    }
  } catch (error) {
    console.error('[Auth] Failed to persist refreshed session:', error);
    return failureResult('transient');
  }

  return { auth: updated };
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns the updated StoredAuth on success, or null on failure.
 * Concurrent calls are deduplicated.
 */
export async function refreshAuthToken(): Promise<StoredAuth | null> {
  return (await refreshAuthSession()).auth;
}

/** Read the current session without reviving tokens from a failed logout. */
export async function readAuthSession(): Promise<StoredAuth | null> {
  const epoch = sessionEpoch;
  await mutationQueue;
  if (sessionEpoch !== epoch || storedSessionBlocked) return null;
  const stored = await getStoredAuth();
  return sessionEpoch === epoch ? stored : null;
}

/**
 * Get a valid auth, refreshing the token if expired.
 * Returns null if not authenticated or refresh fails.
 */
export async function getValidAuth(): Promise<StoredAuth | null> {
  const epoch = sessionEpoch;
  const stored = await readAuthSession();
  if (!stored || sessionEpoch !== epoch) return null;

  if (!isAuthExpired(stored)) return stored;

  // Token is expired — try to refresh
  return refreshAuthToken();
}

/** Access token for API/SSE calls, refreshed when expired. */
export async function getValidAccessToken(): Promise<string | null> {
  const epoch = sessionEpoch;
  const auth = await getValidAuth();
  return sessionEpoch === epoch ? (auth?.accessToken ?? null) : null;
}
