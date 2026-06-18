'use client';

import { useState, useTransition } from 'react';
import { sendBulkEmail } from '@/app/actions/email';

interface SendResult {
  sent: number;
  failed: number;
  errors: { email: string; error: string }[];
}

export function EmailComposer() {
  const [pending, start] = useTransition();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    start(async () => {
      const res = await sendBulkEmail({ subject, markdown: body });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ sent: res.sent, failed: res.failed, errors: res.errors });
      if (res.sent > 0) {
        setSubject('');
        setBody('');
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium tracking-wider text-gray-500 uppercase">
          Subject
        </label>
        <input
          type="text"
          required
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
          }}
          placeholder="Announcement: ..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium tracking-wider text-gray-500 uppercase">
          Body (Markdown)
        </label>
        <textarea
          required
          rows={8}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          placeholder={
            '## Hello\n\nWrite your update in **Markdown**.\n\n- Links: [PairUX](https://pairux.com)\n- Lists, **bold**, _italic_, etc.'
          }
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            result.failed > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          <p className="font-medium">
            Sent {result.sent} · Failed {result.failed}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.errors.map((e) => (
                <li key={e.email}>
                  <span className="font-mono">{e.email}</span>: {e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send to all users'}
      </button>
    </form>
  );
}
