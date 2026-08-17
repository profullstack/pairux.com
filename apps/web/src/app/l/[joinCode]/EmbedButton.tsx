'use client';

import { useState } from 'react';
import { Code2, Copy, Check } from 'lucide-react';

interface EmbedButtonProps {
  /** Ready-made <iframe> snippet, built server-side from the join code. */
  snippet: string;
}

/** Reveal and copy the iframe snippet for this live's embeddable player. */
export function EmbedButton({ snippet }: EmbedButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      /* clipboard blocked — the textarea below is still selectable */
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        title="Embed this live"
      >
        <Code2 className="h-4 w-4" />
        Embed
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label htmlFor="embed-snippet" className="mb-1.5 block text-xs font-medium text-gray-600">
            Paste this anywhere HTML is allowed
          </label>
          <textarea
            id="embed-snippet"
            readOnly
            rows={3}
            value={snippet}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            className="w-full resize-none rounded-md border border-gray-300 bg-white p-2 font-mono text-xs text-gray-800"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      )}
    </div>
  );
}
