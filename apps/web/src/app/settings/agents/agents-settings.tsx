'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, Check, Copy, KeyRound, Loader2, Plug, Trash2, Users } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  handle: string;
  description: string;
  ownerUserId: string;
  orgId: string | null;
  keyPrefix: string;
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
  mine: boolean;
}

async function read<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: string };
  if (!res.ok || !body.data)
    throw new Error(body.error ?? `Request failed (${String(res.status)})`);
  return body.data;
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-violet-300"
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {copied ? done : label}
    </button>
  );
}

// The agent side of the API, for the help block (not translated: it is code).
const AGENT_CALLS = [
  'GET    /api/v1/agent/invites          Authorization: Bearer $PAIRUX_AGENT_KEY',
  'POST   /api/v1/agent/invites/:id      {"action":"accept"}',
  'GET    /api/v1/agents/:participantId?transcriptCursor=0',
  'POST   /api/v1/agents/:participantId/messages   {"content":"..."}',
  'DELETE /api/v1/agents/:participantId',
].join('\n');

export function AgentsSettings({ header }: { header: ReactNode }) {
  const t = useTranslations('copilotPages.agents');
  const locale = useLocale();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [draft, setDraft] = useState({ name: '', handle: '', description: '' });
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.status === 401) {
        window.location.href = '/login?redirect=/settings/agents';
        return;
      }
      setAgents((await read<{ agents: Agent[] }>(res)).agents);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadError'));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const register = () =>
    act(async () => {
      const { agent, key } = await read<{ agent: Agent; key: string }>(
        await fetch('/api/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name.trim(),
            handle: draft.handle.trim(),
            ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
          }),
        })
      );
      setShown({ name: agent.name, key });
      setDraft({ name: '', handle: '', description: '' });
    });

  const rotate = (agent: Agent) => {
    if (!window.confirm(t('confirmRotate', { name: agent.name }))) return;
    void act(async () => {
      const { key } = await read<{ agent: Agent; key: string }>(
        await fetch(`/api/agents/${agent.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'rotate' }),
        })
      );
      setShown({ name: agent.name, key });
    });
  };

  const remove = (agent: Agent) => {
    if (!window.confirm(t('confirmRemove', { name: agent.name }))) return;
    void act(async () => {
      await read(await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' }));
      setShown(null);
    });
  };

  const card = 'mt-6 rounded-xl border border-gray-200 bg-white p-5';
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const runner = `PAIRUX_AGENT_KEY=${shown?.key ?? 'pux_ag_...'} \\\nAGENT_EXEC='claude -p' \\\nnode scripts/agent-runner.mjs`;
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <Link href="/settings/copilot" className="text-sm text-violet-700 hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Bot className="h-7 w-7 text-violet-600" aria-hidden="true" />
          {t('title')}
        </h1>
        <p className="mt-2 text-gray-600">{t('intro')}</p>
        {error && <p className="mt-4 text-red-600">{error}</p>}

        {shown && (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              <KeyRound className="h-5 w-5 text-amber-600" aria-hidden="true" />
              {t('keyTitle', { name: shown.name })}
            </h2>
            <p className="mt-1 text-sm font-medium text-amber-800">{t('keyWarning')}</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono text-sm break-all text-gray-900 ring-1 ring-gray-200">
                {shown.key}
              </code>
              <CopyButton text={shown.key} label={t('copy')} done={t('copied')} />
            </div>
            <button
              type="button"
              onClick={() => {
                setShown(null);
              }}
              className="mt-3 text-sm text-gray-600 underline"
            >
              {t('done')}
            </button>
          </div>
        )}

        {!agents && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}
        {agents && (
          <div className={card}>
            {agents.length === 0 ? (
              <p className="text-gray-600">{t('empty')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {agents.map((agent) => (
                  <li key={agent.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span
                      role="img"
                      aria-label={agent.online ? t('online') : t('offline')}
                      className={`h-2 w-2 shrink-0 rounded-full ${agent.online ? 'bg-green-500' : 'bg-gray-300'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">
                        {agent.name} <span className="text-gray-500">@{agent.handle}</span>
                        {!agent.mine && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">
                            <Users className="h-3 w-3" aria-hidden="true" />
                            {t('shared')}
                          </span>
                        )}
                      </p>
                      {agent.description && (
                        <p className="text-sm text-gray-600">{agent.description}</p>
                      )}
                      <p className="text-xs text-gray-500">
                        {t('keyPrefix', { prefix: agent.keyPrefix })} ·{' '}
                        {agent.online
                          ? t('online')
                          : agent.lastSeenAt
                            ? t('lastSeen', {
                                when: new Date(agent.lastSeenAt).toLocaleString(locale),
                              })
                            : t('neverSeen')}
                      </p>
                    </div>
                    {agent.mine && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            rotate(agent);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
                        >
                          <KeyRound className="h-4 w-4" aria-hidden="true" />
                          {t('rotate')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            remove(agent);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          {t('remove')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <form
          className={card}
          onSubmit={(event) => {
            event.preventDefault();
            void register();
          }}
        >
          <h2 className="font-semibold text-gray-900">{t('registerTitle')}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-800">{t('name')}</span>
              <input
                required
                minLength={2}
                maxLength={50}
                value={draft.name}
                onChange={(event) => {
                  setDraft((all) => ({ ...all, name: event.target.value }));
                }}
                placeholder="riotcoder"
                className={input}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-800">{t('handle')}</span>
              <input
                required
                pattern="[a-z0-9][a-z0-9_\-]{1,31}"
                value={draft.handle}
                onChange={(event) => {
                  setDraft((all) => ({ ...all, handle: event.target.value.toLowerCase() }));
                }}
                placeholder="riotcoder"
                className={input}
              />
              <span className="mt-1 block text-xs text-gray-500">{t('handleHint')}</span>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-gray-800">{t('description')}</span>
            <input
              maxLength={300}
              value={draft.description}
              onChange={(event) => {
                setDraft((all) => ({ ...all, description: event.target.value }));
              }}
              className={input}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !draft.name.trim() || !draft.handle.trim()}
            className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('register')}
          </button>
        </form>

        <div className={card}>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">
            <Plug className="h-5 w-5 text-violet-600" aria-hidden="true" />
            {t('connectTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t('connectIntro')}</p>
          <p className="mt-4 text-sm font-medium text-gray-800">{t('connectRunner')}</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
            {runner}
          </pre>
          <p className="mt-1 text-xs text-gray-500">{t('connectRunnerHint')}</p>
          <p className="mt-4 text-sm font-medium text-gray-800">{t('connectApi')}</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
            {AGENT_CALLS}
          </pre>
          <p className="mt-1 text-xs text-gray-500">{t('connectApiHint')}</p>
        </div>
      </main>
    </div>
  );
}
