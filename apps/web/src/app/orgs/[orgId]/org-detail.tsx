'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Trash2, UserPlus, Users } from 'lucide-react';

type OrgRole = 'owner' | 'admin' | 'member';

interface Member {
  userId: string;
  role: OrgRole;
  displayName: string | null;
  username: string | null;
  email: string | null;
  teams: { teamId: string; role: 'lead' | 'member' }[];
}

interface OrgData {
  id: string;
  name: string;
  owner_id: string;
  myRole: OrgRole;
  plan: string;
  members: Member[];
  teams: { id: string; name: string }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    team_id: string | null;
    expires_at: string;
  }[];
}

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? 'Something went wrong';
}

const who = (m: Member) => m.displayName ?? m.username ?? m.email ?? 'Member';

export function OrgDetail({ orgId, header }: { orgId: string; header: ReactNode }) {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'member', teamId: '' });
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orgs/${orgId}`);
    if (res.status === 401) {
      window.location.href = `/login?redirect=/orgs/${orgId}`;
      return;
    }
    const body = (await res.json()) as { data?: OrgData; error?: string };
    if (!res.ok || !body.data) setError(body.error ?? 'Organization not found');
    else setOrg(body.data);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError('');
    const problem = await call(url, method, body);
    setBusy(false);
    if (problem) setError(problem);
    await load();
    return problem === null;
  };

  const admin = org?.myRole === 'owner' || org?.myRole === 'admin';
  const base = `/api/orgs/${orgId}`;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <Link href="/orgs" className="text-primary-600 text-sm hover:underline">
          ← Organizations
        </Link>
        {!org && !error && <Loader2 className="mt-10 h-6 w-6 animate-spin text-gray-400" />}
        {error && <p className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {org && (
          <div className="mt-6 space-y-8">
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{org.name}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  You are{' '}
                  {org.myRole === 'owner'
                    ? 'the owner'
                    : `a${org.myRole === 'admin' ? 'n' : ''} ${org.myRole}`}
                  . Members are covered by the <strong className="capitalize">{org.plan}</strong>{' '}
                  plan.
                </p>
              </div>
              {org.myRole === 'owner' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${org.name}? Its channels and reports go back to the people who made them.`
                      )
                    ) {
                      void act(base, 'DELETE').then((ok) => {
                        if (ok) window.location.href = '/orgs';
                      });
                    }
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete organization
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Leave ${org.name}?`)) {
                      void fetch('/api/auth/session')
                        .then(
                          async (r) =>
                            ((await r.json()) as { data?: { user?: { id: string } } }).data?.user
                              ?.id
                        )
                        .then((id) => (id ? act(`${base}/members/${id}`, 'DELETE') : false))
                        .then((ok) => {
                          if (ok) window.location.href = '/orgs';
                        });
                    }
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  Leave organization
                </button>
              )}
            </header>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                <Users className="h-5 w-5" aria-hidden="true" /> Members
              </h2>
              <ul className="mt-4 divide-y divide-gray-100">
                {org.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{who(m)}</p>
                      <p className="text-xs text-gray-500">
                        {m.email}
                        {m.teams.length > 0 &&
                          ` · ${m.teams
                            .map((t) => {
                              const team = org.teams.find((x) => x.id === t.teamId);
                              return team
                                ? `${team.name}${t.role === 'lead' ? ' (lead)' : ''}`
                                : '';
                            })
                            .filter(Boolean)
                            .join(', ')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {admin && m.role !== 'owner' ? (
                        <select
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            void act(`${base}/members/${m.userId}`, 'PATCH', {
                              role: e.target.value,
                            })
                          }
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="text-sm text-gray-600 capitalize">{m.role}</span>
                      )}
                      {admin && m.role !== 'owner' && (
                        <button
                          type="button"
                          aria-label={`Remove ${who(m)}`}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Remove ${who(m)} from ${org.name}?`)) {
                              void act(`${base}/members/${m.userId}`, 'DELETE');
                            }
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {admin && (
                <form
                  className="mt-6 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(`${base}/invitations`, 'POST', {
                      email: invite.email,
                      role: invite.role,
                      ...(invite.teamId ? { teamId: invite.teamId } : {}),
                    }).then((ok) => {
                      if (ok) setInvite({ email: '', role: 'member', teamId: '' });
                    });
                  }}
                >
                  <label className="flex-1 text-sm text-gray-700">
                    Invite by email
                    <input
                      type="email"
                      required
                      value={invite.email}
                      onChange={(e) => {
                        setInvite({ ...invite, email: e.target.value });
                      }}
                      placeholder="teammate@company.com"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </label>
                  <select
                    value={invite.role}
                    onChange={(e) => {
                      setInvite({ ...invite, role: e.target.value });
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="member">Member</option>
                    {org.myRole === 'owner' && <option value="admin">Admin</option>}
                  </select>
                  <select
                    value={invite.teamId}
                    onChange={(e) => {
                      setInvite({ ...invite, teamId: e.target.value });
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">No team</option>
                    {org.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={busy}
                    className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4" /> Invite
                  </button>
                </form>
              )}

              {admin && org.invitations.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-gray-700">Pending invitations</h3>
                  <ul className="mt-2 space-y-1 text-sm text-gray-600">
                    {org.invitations.map((i) => (
                      <li key={i.id} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-gray-400" /> {i.email} · {i.role}
                          {i.team_id
                            ? ` · ${org.teams.find((t) => t.id === i.team_id)?.name ?? ''}`
                            : ''}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(`${base}/invitations/${i.id}`, 'DELETE')}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900">Teams</h2>
              <p className="mt-1 text-sm text-gray-600">
                Team members can go live on the team’s channels and read the team’s call reports.
                Leads manage who is in the team.
              </p>
              <div className="mt-4 space-y-4">
                {org.teams.map((team) => {
                  const inTeam = org.members.filter((m) =>
                    m.teams.some((t) => t.teamId === team.id)
                  );
                  const notInTeam = org.members.filter(
                    (m) => !m.teams.some((t) => t.teamId === team.id)
                  );
                  return (
                    <div key={team.id} className="rounded-lg border border-gray-100 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900">{team.name}</p>
                        {admin && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete the ${team.name} team? Its channels and reports stay in the organization.`
                                )
                              ) {
                                void act(`${base}/teams/${team.id}`, 'DELETE');
                              }
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Delete team
                          </button>
                        )}
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {inTeam.map((m) => {
                          const role = m.teams.find((t) => t.teamId === team.id)?.role;
                          return (
                            <li
                              key={m.userId}
                              className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm"
                            >
                              {who(m)}
                              {role === 'lead' && (
                                <span className="text-primary-700 text-xs">lead</span>
                              )}
                              {admin && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="ml-1 text-xs text-gray-500 hover:text-gray-900"
                                    onClick={() =>
                                      void act(`${base}/teams/${team.id}/members`, 'PUT', {
                                        userId: m.userId,
                                        role: role === 'lead' ? 'member' : 'lead',
                                      })
                                    }
                                  >
                                    {role === 'lead' ? 'make member' : 'make lead'}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${who(m)} from ${team.name}`}
                                    disabled={busy}
                                    className="ml-1 text-gray-400 hover:text-red-600"
                                    onClick={() =>
                                      void act(`${base}/teams/${team.id}/members`, 'DELETE', {
                                        userId: m.userId,
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </li>
                          );
                        })}
                        {inTeam.length === 0 && (
                          <li className="text-sm text-gray-500">No members yet</li>
                        )}
                      </ul>
                      {admin && notInTeam.length > 0 && (
                        <select
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value) {
                              void act(`${base}/teams/${team.id}/members`, 'PUT', {
                                userId: e.target.value,
                                role: 'member',
                              });
                            }
                          }}
                          className="mt-3 rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="">Add a member…</option>
                          {notInTeam.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {who(m)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
                {org.teams.length === 0 && <p className="text-sm text-gray-500">No teams yet.</p>}
              </div>
              {admin && (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(`${base}/teams`, 'POST', { name: teamName }).then((ok) => {
                      if (ok) setTeamName('');
                    });
                  }}
                >
                  <input
                    value={teamName}
                    onChange={(e) => {
                      setTeamName(e.target.value);
                    }}
                    placeholder="New team, e.g. Engineering"
                    minLength={2}
                    maxLength={60}
                    required
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
                  >
                    Create team
                  </button>
                </form>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
