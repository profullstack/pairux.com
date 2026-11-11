'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';

interface Grant {
  id: string;
  client_name: string;
  client_uri: string | null;
  created_at: string;
  last_used_at: string | null;
}

/**
 * AI apps (ChatGPT, Claude, …) connected to the PairUX MCP server over OAuth
 * (lib/mcp-oauth.ts). Disconnecting ends that app's tokens at once. Renders
 * nothing until an app has been connected.
 */
export function ConnectedApps() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/oauth/grants');
      if (res.ok) setGrants(((await res.json()) as { grants: Grant[] }).grants);
    } catch {
      // leave the list unloaded
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await fetch(`/api/oauth/grants?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  if (!grants?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white" id="connected-apps">
      <div className="border-b border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Bot className="h-5 w-5 text-gray-700" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Connected apps</h2>
            <p className="text-sm text-gray-500">
              AI apps that can use the PairUX MCP tools as you.
            </p>
          </div>
        </div>
      </div>
      <ul className="divide-y divide-gray-100">
        {grants.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-4 p-6">
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">{g.client_name}</p>
              <p className="text-xs text-gray-500">
                Connected {new Date(g.created_at).toLocaleDateString()}
                {g.last_used_at
                  ? ` · last used ${new Date(g.last_used_at).toLocaleDateString()}`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void disconnect(g.id)}
              disabled={busy === g.id}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {busy === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
