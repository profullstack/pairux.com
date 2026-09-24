'use client';

import { useState } from 'react';
import { Bot, Loader2, Terminal } from 'lucide-react';
import { isLoopbackRedirect } from '@/lib/loopback';

interface Props {
  email: string;
  clientName: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}

export function CliAuthorizeConsent({
  email,
  clientName,
  codeChallenge,
  redirectUri,
  state,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'allowed' | 'denied' | null>(null);

  async function allow() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/cli/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codeChallenge,
          codeChallengeMethod: 'S256',
          redirectUri,
          state,
          clientName,
        }),
      });
      const body = (await res.json()) as { data?: { redirect: string }; error?: string };
      if (!res.ok || !body.data) {
        setError(body.error ?? 'Could not authorize the CLI');
        return;
      }
      setDone('allowed');
      window.location.href = body.data.redirect;
    } catch {
      setError('Could not reach PairUX. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function deny() {
    // The page already refused non-loopback redirects; check again right where
    // the browser navigates, so this can never become an open redirect.
    if (!isLoopbackRedirect(redirectUri)) {
      setDone('denied');
      return;
    }
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('state', state);
    setDone('denied');
    window.location.href = url.toString();
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">
          {done === 'allowed' ? 'You can return to your terminal' : 'Sign-in cancelled'}
        </h1>
        <p className="mt-2 text-sm text-gray-600">You can close this tab.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <Terminal className="text-primary-600 h-8 w-8" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-gray-900">Authorize {clientName}?</h1>
      </div>
      <p className="mt-4 text-gray-600">
        The PairUX command-line tool on this computer is asking to act as{' '}
        <strong className="text-gray-900">{email}</strong>.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-gray-600">
        <li className="flex gap-2">
          <Bot className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          Agents you start with it join sessions labelled as your agent, so hosts know whose they
          are.
        </li>
        <li>It cannot see your screen, take remote control, or change your account.</li>
        <li>
          Signing out with <code className="rounded bg-gray-100 px-1">pairux logout</code> revokes
          it.
        </li>
      </ul>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => void allow()}
          disabled={busy}
          className="bg-primary-600 hover:bg-primary-700 inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Allow
        </button>
        <button
          type="button"
          onClick={deny}
          disabled={busy}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
