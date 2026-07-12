'use client';

import { useState } from 'react';
import { Share2, Copy, Check } from 'lucide-react';

interface ShareButtonsProps {
  handle: string;
  name: string;
}

/** Share a channel — native share (mobile), the usual socials, and copy link. */
export function ShareButtons({ handle, name }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const url = `https://pairux.com/@${handle}`;
  const text = `Check out ${name} on PairUX`;
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);

  const socials: { label: string; href: string }[] = [
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { label: 'Reddit', href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: name, text, url });
    } catch {
      /* user cancelled or unsupported */
    }
  };

  const hasNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasNativeShare && (
        <button
          type="button"
          onClick={() => void nativeShare()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          title="Share"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
      )}
      {socials.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          title={`Share on ${s.label}`}
        >
          {s.label}
        </a>
      ))}
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        title="Copy link"
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
