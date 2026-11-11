import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Bot } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AUTHORIZE_FIELDS, checkAuthorize, oauthDb, type AuthorizeParams } from '@/lib/mcp-oauth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect an app',
  description:
    'Allow an AI app (ChatGPT, Claude, …) to use your PairUX account through the PairUX MCP server.',
  robots: { index: false, follow: false },
};

/**
 * The OAuth 2.1 authorization endpoint for the MCP server at /api/v1/mcp.
 * Validates the request (an unknown client or redirect is shown here, never
 * followed), sends a signed-out visitor through /login and back, then asks the
 * signed-in user to allow or deny. The form posts to /api/oauth/authorize.
 */
export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p: AuthorizeParams = {};
  for (const k of AUTHORIZE_FIELDS) {
    const v = sp[k];
    if (typeof v === 'string') (p as Record<string, unknown>)[k] = v;
  }

  const check = await checkAuthorize(oauthDb(), p);
  if (!check.ok) {
    if ('redirect' in check) redirect(check.redirect);
    return (
      <main className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-2xl font-bold text-gray-900">This connection request is not valid</h1>
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {check.description}
        </p>
        <p className="mt-6 text-sm text-gray-600">
          Go back to the app you came from and connect PairUX again.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams(p as Record<string, string>).toString();
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const redirectHost = new URL(check.redirectUri).host;
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <Bot className="text-primary-600 h-8 w-8 flex-none" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-gray-900">
            Allow <span className="break-words">{check.client.client_name}</span> to use your PairUX
            account?
          </h1>
        </div>
        <p className="mt-4 text-gray-600">
          Signed in as <strong className="text-gray-900">{user.email ?? 'your account'}</strong>.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-gray-600">
          <li>
            It can use the PairUX MCP tools as you: read your AI copilot notes and follow-ups, ask
            your live copilot about a meeting, and invite your agents into meetings you are in.
          </li>
          <li>
            You will be sent back to <strong className="text-gray-900">{redirectHost}</strong>.
          </li>
          <li>
            Access lasts until you disconnect it in Settings; tokens expire hourly and are
            refreshed.
          </li>
        </ul>
        {check.client.client_uri && (
          <p className="mt-4 text-xs text-gray-500">App site: {check.client.client_uri}</p>
        )}
        <form method="post" action="/api/oauth/authorize" className="mt-6 flex gap-3">
          {AUTHORIZE_FIELDS.map((k) => {
            const v = (p as Record<string, unknown>)[k];
            return typeof v === 'string' ? (
              <input key={k} type="hidden" name={k} value={v} />
            ) : null;
          })}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="allow"
            className="bg-primary-600 hover:bg-primary-700 flex-1 rounded-lg px-4 py-2 font-semibold text-white"
          >
            Allow
          </button>
        </form>
      </div>
    </main>
  );
}
