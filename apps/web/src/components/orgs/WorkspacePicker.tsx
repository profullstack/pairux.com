'use client';

import { useEffect, useState } from 'react';

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
  teams: { id: string; name: string; myRole: 'lead' | 'member' | null }[];
}

export interface Workspace {
  orgId?: string;
  teamId?: string;
}

/** The caller's organizations and teams, for "where does this belong" pickers. */
export function useMyOrgs(): MyOrg[] | null {
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch('/api/orgs')
      .then(async (res) => (res.ok ? (((await res.json()) as { data?: MyOrg[] }).data ?? []) : []))
      .catch(() => [])
      .then((list) => {
        if (alive) setOrgs(list);
      });
    return () => {
      alive = false;
    };
  }, []);
  return orgs;
}

function encode(w: Workspace): string {
  return w.teamId ? `team:${w.teamId}` : w.orgId ? `org:${w.orgId}` : 'personal';
}

function decode(value: string, orgs: MyOrg[]): Workspace {
  if (value.startsWith('team:')) {
    const teamId = value.slice(5);
    const org = orgs.find((o) => o.teams.some((t) => t.id === teamId));
    return org ? { orgId: org.id, teamId } : {};
  }
  if (value.startsWith('org:')) return { orgId: value.slice(4) };
  return {};
}

/**
 * Personal, an organization, or one of its teams. Only teams the user is in
 * are offered, plus every team for org admins. Renders nothing when the user
 * belongs to no organization.
 */
export function WorkspacePicker({
  orgs,
  value,
  onChange,
  label = 'Workspace',
  requireManage = false,
  className = '',
}: {
  orgs: MyOrg[] | null;
  value: Workspace;
  onChange: (next: Workspace) => void;
  label?: string;
  /** Only offer places the user can manage (org admin, or team lead). */
  requireManage?: boolean;
  className?: string;
}) {
  if (!orgs || orgs.length === 0) return null;
  const isAdmin = (o: MyOrg) => o.role === 'owner' || o.role === 'admin';
  return (
    <label className={`block text-sm text-gray-700 ${className}`}>
      {label}
      <select
        value={encode(value)}
        onChange={(e) => {
          onChange(decode(e.target.value, orgs));
        }}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
        data-testid="workspace-picker"
      >
        <option value="personal">Personal</option>
        {orgs.map((org) => (
          <optgroup key={org.id} label={org.name}>
            {(!requireManage || isAdmin(org)) && (
              <option value={`org:${org.id}`}>{org.name} (whole organization)</option>
            )}
            {org.teams
              .filter((t) =>
                requireManage
                  ? isAdmin(org) || t.myRole === 'lead'
                  : isAdmin(org) || t.myRole !== null
              )
              .map((t) => (
                <option key={t.id} value={`team:${t.id}`}>
                  {org.name} › {t.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
