'use client';

import { useCallback, useEffect, useState } from 'react';

interface CodeRow {
  id: string;
  label: string;
  plan: string | null;
  days: number;
  maxRedemptions: number;
  redemptions: number;
  expiresAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

/** /admin: mint, list and revoke credit codes (plan days). English only, admin-only. */
export function CreditCodesAdmin() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [plan, setPlan] = useState('pro');
  const [days, setDays] = useState('30');
  const [label, setLabel] = useState('');
  const [max, setMax] = useState('1');
  const [expires, setExpires] = useState('');
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/credit-codes', { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { data?: CodeRow[] };
    setCodes(body.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setMinted(null);
    const res = await fetch('/api/admin/credit-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        days: Number(days),
        label,
        maxRedemptions: Number(max),
        expiresInDays: Number(expires || 0),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { code: string };
      error?: string;
    };
    if (body.data) {
      setMinted(body.data.code);
      setLabel('');
      await load();
    } else setError(body.error ?? 'Mint failed');
  }

  async function revoke(id: string) {
    await fetch(`/api/admin/credit-codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void mint(e)} className="grid gap-2 sm:grid-cols-6">
        <select
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
          }}
          className={input}
          aria-label="Plan"
        >
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
          <option value="team">Team</option>
        </select>
        <input
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
          }}
          className={input}
          aria-label="Days"
          placeholder="Days"
          inputMode="numeric"
        />
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          className={`${input} sm:col-span-2`}
          placeholder="Label (who it is for)"
        />
        <input
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
          }}
          className={input}
          aria-label="Max redemptions"
          placeholder="Max uses"
          inputMode="numeric"
        />
        <input
          value={expires}
          onChange={(e) => {
            setExpires(e.target.value);
          }}
          className={input}
          aria-label="Expires in days"
          placeholder="Expires (days)"
          inputMode="numeric"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white sm:col-span-6"
        >
          Mint code
        </button>
      </form>
      {minted && (
        <p className="rounded-lg border border-green-200 bg-green-50 p-3 font-mono text-sm text-green-900">
          {minted}{' '}
          <span className="font-sans text-xs text-green-700">
            (shown once; only its hash is stored)
          </span>
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {codes.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs tracking-wider text-gray-500 uppercase">
            <tr>
              <th className="py-2 pr-2">Label</th>
              <th className="py-2 pr-2">Grant</th>
              <th className="py-2 pr-2">Used</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {codes.map((c) => (
              <tr key={c.id} className={c.revokedAt ? 'text-gray-400 line-through' : ''}>
                <td className="py-2 pr-2">{c.label}</td>
                <td className="py-2 pr-2">
                  {c.days}d {c.plan ?? '?'}
                </td>
                <td className="py-2 pr-2">
                  {c.redemptions}/{c.maxRedemptions}
                </td>
                <td className="py-2 text-right">
                  {!c.revokedAt && (
                    <button
                      onClick={() => void revoke(c.id)}
                      className="text-xs text-red-600 underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
