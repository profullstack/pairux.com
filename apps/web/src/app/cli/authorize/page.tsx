import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isLoopbackRedirect, isValidChallenge } from '@/lib/cli-auth';
import { CliAuthorizeConsent } from './consent';

export const metadata: Metadata = {
  title: 'Authorize the PairUX CLI - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * /cli/authorize — the consent screen `pairux login` opens in the browser.
 * OAuth 2.1 authorization endpoint: response_type=code, S256 PKCE, loopback
 * redirect only.
 */
export default async function CliAuthorizePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const codeChallenge = one(params.code_challenge);
  const method = one(params.code_challenge_method);
  const redirectUri = one(params.redirect_uri);
  const state = one(params.state);
  const clientName = one(params.client_name) || 'PairUX CLI';

  const valid =
    one(params.response_type) === 'code' &&
    method === 'S256' &&
    isValidChallenge(codeChallenge) &&
    isLoopbackRedirect(redirectUri) &&
    state.length >= 8;

  if (!valid) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900">This sign-in link is not valid</h1>
        <p className="mt-4 text-gray-600">
          Run <code className="rounded bg-gray-100 px-1">pairux login</code> again to get a fresh
          one.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const back = `/cli/authorize?${new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string')
    ).toString()}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <CliAuthorizeConsent
        email={user.email ?? ''}
        clientName={clientName}
        codeChallenge={codeChallenge}
        redirectUri={redirectUri}
        state={state}
      />
    </main>
  );
}
