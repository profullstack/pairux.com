'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Building2, Loader2 } from 'lucide-react';

interface InvitePreview {
  orgName: string;
  teamName: string | null;
  role: string;
  email: string;
  expired: boolean;
}

export function AcceptInvite({ token, header }: { token: string; header: ReactNode }) {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/org-invitations/${encodeURIComponent(token)}`).then(async (res) => {
      const body = (await res.json()) as { data?: InvitePreview; error?: string };
      if (!res.ok || !body.data) setError(body.error ?? 'This invitation is no longer valid');
      else setInvite(body.data);
    });
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/org-invitations/${encodeURIComponent(token)}`, {
      method: 'POST',
    });
    const body = (await res.json()) as { data?: { orgId: string }; error?: string };
    setBusy(false);
    if (res.status === 401) {
      window.location.href = `/login?redirect=${encodeURIComponent(`/orgs/invite/${token}`)}`;
      return;
    }
    if (!res.ok || !body.data) {
      setError(body.error ?? 'Could not accept the invitation');
      return;
    }
    window.location.href = `/orgs/${body.data.orgId}`;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-20">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Building2 className="text-primary-600 mx-auto h-10 w-10" aria-hidden="true" />
          {!invite && !error && (
            <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-gray-400" />
          )}
          {invite && (
            <>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Join {invite.orgName}</h1>
              <p className="mt-2 text-gray-600">
                You are invited as {invite.role === 'admin' ? 'an admin' : 'a member'}
                {invite.teamName ? ` of the ${invite.teamName} team` : ''}. Sign in as{' '}
                <strong>{invite.email}</strong> to accept.
              </p>
              {invite.expired ? (
                <p className="mt-6 text-sm text-red-600">
                  This invitation has expired. Ask for a new one.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void accept()}
                  disabled={busy}
                  className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold text-white disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Accept invitation
                </button>
              )}
            </>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      </main>
    </div>
  );
}
