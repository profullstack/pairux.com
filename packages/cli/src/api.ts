/**
 * Thin client for the PairUX agent API (/api/v1/agents/*, /api/v1/cli/me).
 * Responses come back as { data } or { error }, like every PairUX route.
 */

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

  private async request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.opts.userAgent ?? 'pairux-cli',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    };
    if (auth && this.opts.getAccessToken) {
      const token = await this.opts.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
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
}
