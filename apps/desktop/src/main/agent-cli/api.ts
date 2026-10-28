/**
 * Thin client for the PairUX agent API (/api/v1/agents/*, /api/v1/cli/me) and
 * the meeting copilot API (/api/copilot/*, /api/sessions/:id/copilot/*).
 * Responses come back as { data } or { error }, like every PairUX route.
 */
import type {
  CopilotMode,
  CopilotRole,
  CopilotState,
  CopilotStatus,
} from '@pairux/meeting-copilot/types';

export interface RosterEntry {
  id: string;
  display_name: string;
  role: string;
  kind: string;
  agent_client: string | null;
  control_state: string;
}

export interface ChatMessage {
  id: string;
  display_name: string;
  content: string;
  message_type: string;
  created_at: string;
}

export interface PollResult {
  you: { id: string; displayName: string };
  session: { id: string; status: string; subject: string | null; joinCode: string };
  participants: RosterEntry[];
  messages: ChatMessage[];
  serverTime: string;
}

export interface JoinResult {
  participantId: string;
  sessionId: string;
  displayName: string;
  owned: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }

  /** The agent was removed by the host, left, or the session ended. */
  get gone(): boolean {
    return this.status === 410;
  }
}

export interface ClientOptions {
  apiUrl: string;
  /** Returns a current access token, or null to call anonymously. */
  getAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class PairuxClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** The PairUX origin this client talks to, without a trailing slash. */
  get baseUrl(): string {
    return this.opts.apiUrl;
  }

  private async headers(init: RequestInit, auth: boolean, accept = 'application/json') {
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': this.opts.userAgent ?? 'pairux',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    };
    if (auth && this.opts.getAccessToken) {
      const token = await this.opts.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
    const headers = await this.headers(init, auth);
    const res = await this.fetchImpl(`${this.opts.apiUrl}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!res.ok || body.data === undefined) {
      throw new ApiError(res.status, body.error ?? `Request failed (${String(res.status)})`);
    }
    return body.data;
  }

  me() {
    return this.request<{ userId: string; displayName: string | null; username: string | null }>(
      '/api/v1/cli/me',
      {},
      true
    );
  }

  join(args: { joinCode: string; name: string; client?: string }, signedIn: boolean) {
    return this.request<JoinResult>(
      '/api/v1/agents/join',
      { method: 'POST', body: JSON.stringify(args) },
      signedIn
    );
  }

  poll(participantId: string, after?: string) {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    return this.request<PollResult>(`/api/v1/agents/${encodeURIComponent(participantId)}${query}`);
  }

  say(participantId: string, content: string) {
    return this.request<ChatMessage>(
      `/api/v1/agents/${encodeURIComponent(participantId)}/messages`,
      { method: 'POST', body: JSON.stringify({ content }) }
    );
  }

  leave(participantId: string) {
    return this.request<{ left: boolean }>(`/api/v1/agents/${encodeURIComponent(participantId)}`, {
      method: 'DELETE',
    });
  }

  /** Look up a live session by its 6-character join code. */
  lookupJoinCode(joinCode: string) {
    return this.request<{ id: string; status?: string; scheduled?: boolean }>(
      `/api/sessions/join/${encodeURIComponent(joinCode)}`
    );
  }

  /** The copilot API; every call is signed in. */
  copilot(): CopilotApi {
    return new CopilotApi(this, (path, init) => this.request(path, init, true));
  }

  /** POST to a text/event-stream endpoint, signed in; the body or an ApiError. */
  async openStream(path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const init: RequestInit = { method: 'POST', body: '{}', ...(signal ? { signal } : {}) };
    const headers = await this.headers(init, true, 'text/event-stream');
    const res = await this.fetchImpl(`${this.opts.apiUrl}${path}`, { ...init, headers });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? `Request failed (${String(res.status)})`);
    }
    return res.body;
  }

  /** Redeem a credit code (adds days of a paid plan). */
  redeem(code: string) {
    return this.request<{
      plan: string;
      days: number;
      effectivePlan: string;
      planExpiresAt: string | null;
      message: string;
    }>('/api/credits/redeem', { method: 'POST', body: JSON.stringify({ code }) }, true);
  }

  invites() {
    return this.request<InvitesOverview>('/api/invites', {}, true);
  }

  createInvite(note: string) {
    return this.request<{ id: string; code: string; url: string; expiresAt: number | null }>(
      '/api/invites',
      { method: 'POST', body: JSON.stringify({ note }) },
      true
    );
  }
}

/** Signed-in calls to the meeting copilot API. */
export class CopilotApi {
  constructor(
    private readonly client: PairuxClient,
    private readonly call: <T>(path: string, init?: RequestInit) => Promise<T>
  ) {}

  private session(sessionId: string, suffix = '') {
    return `/api/sessions/${encodeURIComponent(sessionId)}/copilot${suffix}`;
  }

  status(sessionId: string) {
    return this.call<CopilotStatus>(this.session(sessionId));
  }

  start(sessionId: string, opts: { role?: CopilotRole; mode?: CopilotMode }) {
    return this.call<CopilotState>(this.session(sessionId), {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  stop(sessionId: string) {
    return this.call<CopilotState>(this.session(sessionId), { method: 'DELETE' });
  }

  ask(sessionId: string, question: string) {
    return this.call<{ answer: string }>(this.session(sessionId, '/ask'), {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  }

  recap(sessionId: string, seconds?: number) {
    return this.call<{ recap: string; seconds: number }>(this.session(sessionId, '/recap'), {
      method: 'POST',
      body: JSON.stringify(seconds === undefined ? {} : { seconds }),
    });
  }

  /** The live event stream; the caller reads it with readSseEvents. */
  stream(sessionId: string, signal?: AbortSignal) {
    return this.client.openStream(this.session(sessionId, '/stream'), signal);
  }

  list() {
    return this.call<{ copilots: CopilotSummary[] }>('/api/copilot');
  }

  get(id: string) {
    return this.call<{ copilot: CopilotState; title: string | null }>(
      `/api/copilot/${encodeURIComponent(id)}`
    );
  }

  write(id: string, what: 'follow-ups' | 'review') {
    return this.call<Pick<CopilotState, 'followUps' | 'review'>>(
      `/api/copilot/${encodeURIComponent(id)}/${what}`,
      { method: 'POST', body: '{}' }
    );
  }

  settings() {
    return this.call<CopilotSettingsView>('/api/copilot/settings');
  }

  saveSettings(patch: CopilotSettingsPatch) {
    return this.call<CopilotSettingsView>('/api/copilot/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  wallet() {
    return this.call<CopilotWallet>('/api/copilot/wallet');
  }
}

export const KEY_PROVIDERS = ['anthropic', 'openai', 'elevenlabs'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

export interface CopilotSummary {
  id: string;
  sessionId: string;
  role: string;
  mode: string;
  status: string;
  title: string | null;
  summary: string;
  startedAt: string;
  endedAt: string | null;
}

export interface CopilotSettingsView {
  mode: CopilotMode;
  role: CopilotRole;
  keys: Record<KeyProvider, { set: boolean; last4: string | null }>;
  /** GET only. */
  eligible?: boolean;
  byokAvailable?: boolean;
  /** Own keys are sealed under a key passphrase set at pairux.com/settings/copilot. */
  passphraseSet?: boolean;
  balance?: string;
  balanceMicros?: number;
}

export interface CopilotSettingsPatch {
  mode?: CopilotMode;
  role?: CopilotRole;
  keys?: Partial<Record<KeyProvider, string | null>>;
}

export interface CopilotWallet {
  balance: string;
  balanceMicros: number;
  markup: number;
  topups: { id: string; priceUsd: number }[];
  usage: {
    sessionId: string;
    provider: string;
    kind: string;
    units: number;
    charge: string;
    chargeMicros: number;
    status: string;
    at: string;
  }[];
}

export interface InvitesOverview {
  quota: { total: number; used: number; left: number };
  invites: {
    id: string;
    status: string;
    note: string;
    usedByName?: string | null;
    bonus?: string;
    expiresAt: number | null;
  }[];
  canInvite: boolean;
  unlocksAt: string | null;
  bonusDays: number;
  refLink: string;
}
