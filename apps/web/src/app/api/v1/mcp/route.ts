import { NextResponse } from 'next/server';
import { CopilotLlmError } from '@/lib/copilot/llm';
import { MCP_PROTOCOL_VERSION, MCP_TOOLS, McpToolError, callMcpTool } from '@/lib/copilot/mcp';
import { copilotRuntime } from '@/lib/copilot/runtime';
import { requestUser } from '@/lib/request-user';
import { ACCESS_PREFIX, oauthDb, resolveAccessToken, resourceMetadataUrl } from '@/lib/mcp-oauth';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const callsByUser = new FixedWindowRateLimiter(120, 60_000);

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const reply = (id: JsonRpcRequest['id'], result: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});
const failure = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

async function handle(message: JsonRpcRequest, userId: string): Promise<object | null> {
  const { id, method, params = {} } = message;
  // Notifications (no id) get no reply.
  if (id === undefined) return null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pairux', title: 'PairUX', version: '1.1.0' },
        instructions:
          'PairUX AI copilot: list your meeting copilots, read their notes and follow-ups, and ask a live copilot about the meeting in progress.',
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      // resultType + ttlMs + cacheScope: Claude Code's client (revision
      // 2026-07-28) rejects a list without them ("tools fetch failed").
      return reply(id, {
        tools: MCP_TOOLS,
        resultType: 'complete',
        ttlMs: 300_000,
        cacheScope: 'private',
      });
    case 'tools/call': {
      const runtime = copilotRuntime();
      if (!runtime) return failure(id, -32603, 'The AI copilot is turned off on this server.');
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await callMcpTool(runtime, userId, name, args);
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (error) {
        if (error instanceof McpToolError || error instanceof CopilotLlmError)
          return reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
        console.error('[mcp] tool failed:', error);
        return failure(id, -32603, 'The tool failed.');
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${String(method)}`);
  }
}

/**
 * Who is calling: an OAuth access token (pux_oat_, lib/mcp-oauth.ts) that
 * ChatGPT, claude.ai or Claude Code obtained via dynamic client registration +
 * PKCE, accepted here and nowhere else; otherwise a `pairux login` CLI token
 * (pux_at_) or a PairUX session, exactly as before.
 */
async function mcpUser(request: Request): Promise<{ id: string } | null> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (token.startsWith(ACCESS_PREFIX)) {
    const grant = await resolveAccessToken(oauthDb(), token);
    return grant ? { id: grant.userId } : null;
  }
  return requestUser(request);
}

/**
 * HTTP 401 + WWW-Authenticate pointing at the protected-resource metadata
 * (RFC 9728, MCP authorization spec): this is what starts the OAuth flow in
 * ChatGPT and claude.ai connectors.
 */
function unauthorized(hadToken: boolean) {
  const challenge = [
    'Bearer realm="pairux"',
    `resource_metadata="${resourceMetadataUrl()}"`,
    ...(hadToken
      ? ['error="invalid_token"', 'error_description="The access token is invalid or expired"']
      : []),
  ].join(', ');
  return NextResponse.json(
    failure(
      null,
      -32001,
      'Unauthorized: connect with OAuth, or send Authorization: Bearer <pairux token>.'
    ),
    {
      status: 401,
      headers: {
        'WWW-Authenticate': challenge,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
        'Cache-Control': 'no-store',
      },
    }
  );
}

// POST /api/v1/mcp — MCP over Streamable HTTP (JSON responses). Bearer auth:
// an OAuth access token, a `pairux login` CLI token or a PairUX session token.
export async function POST(request: Request) {
  const user = await mcpUser(request);
  if (!user) return unauthorized(/^Bearer\s+\S/i.test(request.headers.get('authorization') ?? ''));
  if (!callsByUser.check(user.id).success)
    return NextResponse.json(failure(null, -32000, 'Too many requests.'), { status: 429 });
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object')
    return NextResponse.json(failure(null, -32700, 'Parse error'), { status: 400 });
  if (Array.isArray(parsed)) {
    const replies = (
      await Promise.all(parsed.map((one) => handle(one as JsonRpcRequest, user.id)))
    ).filter(Boolean);
    return replies.length ? NextResponse.json(replies) : new Response(null, { status: 202 });
  }
  const answer = await handle(parsed as JsonRpcRequest, user.id);
  return answer ? NextResponse.json(answer) : new Response(null, { status: 202 });
}

// No server-initiated stream: GET is not offered (Streamable HTTP allows 405).
// Without a credential it is a 401 like POST, so a probe still finds the
// protected-resource metadata.
export async function GET(request: Request) {
  if (!(await mcpUser(request)))
    return unauthorized(/^Bearer\s+\S/i.test(request.headers.get('authorization') ?? ''));
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
