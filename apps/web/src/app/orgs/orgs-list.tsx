'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Building2, Loader2, Plus } from 'lucide-react';
import type { MyOrg } from '@/components/orgs/WorkspacePicker';

export function OrgsList({ header }: { header: ReactNode }) {
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/orgs');
    if (res.status === 401) {
      window.location.href = '/login?redirect=/orgs';
      return;
    }
    setOrgs(((await res.json()) as { data?: MyOrg[] }).data ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { data?: MyOrg; error?: string };
    setBusy(false);
    if (!res.ok || !body.data) {
      setError(body.error ?? 'Could not create the organization');
      return;
    }
    window.location.href = `/orgs/${body.data.id}`;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Building2 className="text-primary-600 h-7 w-7" aria-hidden="true" />
          Organizations
        </h1>
        <p className="mt-2 text-gray-600">
          An organization shares channels to go live on, call analysis reports and its owner’s plan
          with its members. Group people into teams inside it.
        </p>

        {!orgs && <Loader2 className="mt-10 h-6 w-6 animate-spin text-gray-400" />}
        <ul className="mt-8 space-y-3">
          {orgs?.map((org) => (
            <li key={org.id}>
              <Link
                href={`/orgs/${org.id}`}
                className="hover:border-primary-300 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4"
              >
                <div>
                  <p className="font-semibold text-gray-900">{org.name}</p>
                  <p className="text-sm text-gray-500">
                    {org.teams.length} team{org.teams.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 capitalize">
                  {org.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => void create(e)}
          className="mt-10 rounded-xl border border-gray-200 bg-white p-6"
        >
          <h2 className="font-semibold text-gray-900">Create an organization</h2>
          <div className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Company or group name"
              minLength={2}
              maxLength={80}
              required
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      </main>
    </div>
  );
}
