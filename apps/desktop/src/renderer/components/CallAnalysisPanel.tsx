import { Sparkles } from 'lucide-react';
import type { CallAnalysisKind } from '@pairux/shared-types';
import { useEffect, useState } from 'react';
import {
  readWorkspace,
  useAnalysisPreference,
  writeWorkspace,
  type CallWorkspace,
} from '@/lib/callAnalysisPreference';
import type { MyOrgSummary } from '../../preload/api';
import { getElectronAPI } from '@/lib/ipc';

const KIND_LABELS: Record<CallAnalysisKind, string> = {
  general: 'General call',
  interview: 'Interview',
  'team-sync': 'Team sync',
  presentation: 'Presentation',
};

/**
 * Home-screen switch for AI call analysis: decided before a call starts and
 * applied to the next session this app creates. Turning it on turns
 * "Record the call" on with it.
 */
export function CallAnalysisPanel({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useAnalysisPreference();
  const [orgs, setOrgs] = useState<MyOrgSummary[]>([]);
  const [workspace, setWorkspace] = useState<CallWorkspace>(readWorkspace);
  useEffect(() => {
    void getElectronAPI()
      .invoke('orgs:list', undefined)
      .then((list) => {
        setOrgs(list);
        // Forget a workspace the user is no longer part of.
        const current = readWorkspace();
        const known =
          !current.orgId ||
          list.some(
            (o) =>
              o.id === current.orgId &&
              (!current.teamId || o.teams.some((t) => t.id === current.teamId))
          );
        if (!known) {
          writeWorkspace({});
          setWorkspace({});
        }
      })
      .catch(() => undefined);
  }, []);
  const workspaceValue = workspace.teamId
    ? `team:${workspace.teamId}`
    : workspace.orgId
      ? `org:${workspace.orgId}`
      : 'personal';

  return (
    <div
      className="mb-6 rounded-lg border border-violet-500/30 bg-violet-500/10 p-4"
      data-testid="call-analysis-panel"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-violet-400" />
            AI call analysis
            <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Pro
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Feedback after the call on talk time, pace, filler words and what to practice. Applies
            to the next call you start; it cannot be switched on mid-call.{' '}
            <button
              type="button"
              className="text-violet-300 underline"
              onClick={() => void getElectronAPI().invoke('auth:openExternal', '/analyses')}
            >
              Your reports
            </button>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          aria-label="Analyze the next call"
          disabled={disabled}
          onClick={() => {
            setValue(
              value.enabled
                ? { ...value, enabled: false }
                : { ...value, enabled: true, keepRecording: true }
            );
          }}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            value.enabled ? 'bg-violet-600' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              value.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {orgs.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          Workspace
          <select
            value={workspaceValue}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              let next: CallWorkspace = {};
              if (v.startsWith('org:')) next = { orgId: v.slice(4) };
              if (v.startsWith('team:')) {
                const teamId = v.slice(5);
                const org = orgs.find((o) => o.teams.some((t) => t.id === teamId));
                if (org) next = { orgId: org.id, teamId };
              }
              writeWorkspace(next);
              setWorkspace(next);
            }}
            className="rounded-md border border-border bg-background px-2 py-1"
            data-testid="desktop-workspace-picker"
          >
            <option value="personal">Personal</option>
            {orgs.map((org) => (
              <optgroup key={org.id} label={org.name}>
                <option value={`org:${org.id}`}>{org.name} (whole organization)</option>
                {org.teams
                  .filter((t) => org.role !== 'member' || t.myRole !== null)
                  .map((t) => (
                    <option key={t.id} value={`team:${t.id}`}>
                      {org.name} › {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            A team call’s report is shared with the team.
          </span>
        </label>
      )}
      {value.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            Call type
            <select
              value={value.kind}
              disabled={disabled}
              onChange={(e) => {
                setValue({ ...value, kind: e.target.value as CallAnalysisKind });
              }}
              className="rounded-md border border-border bg-background px-2 py-1"
            >
              {(Object.keys(KIND_LABELS) as CallAnalysisKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.keepRecording}
              disabled={disabled}
              onChange={(e) => {
                setValue({ ...value, keepRecording: e.target.checked });
              }}
            />
            Record the call and keep the recording
          </label>
          <span className="text-xs text-muted-foreground">
            Everyone who joins is told the call is recorded for AI analysis.
          </span>
        </div>
      )}
    </div>
  );
}
