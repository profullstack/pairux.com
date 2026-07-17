'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';

interface MessagesNavLinkProps {
  /** Mobile menu variant: full-width row with a label instead of an icon button. */
  variant?: 'icon' | 'row';
  onNavigate?: () => void;
}

/**
 * Header entry point to the DM inbox, with an unread badge that polls
 * /api/messages/unread every 30s. Only rendered for signed-in users.
 */
export function MessagesNavLink({
  variant = 'icon',
  onNavigate = () => {
    /* no-op */
  },
}: MessagesNavLinkProps) {
  const [unread, setUnread] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/unread', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { unread?: number } };
      setUnread(json.data?.unread ?? 0);
    } catch {
      // ignore transient failures
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), 30000);
    return () => {
      clearInterval(id);
    };
  }, [poll]);

  const badge = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;

  if (variant === 'row') {
    return (
      <Link
        href="/messages"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      >
        <MessageCircle className="h-5 w-5" />
        <span>Messages</span>
        {badge && (
          <span className="bg-primary-600 ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/messages"
      onClick={onNavigate}
      aria-label="Messages"
      className="relative flex items-center text-gray-600 transition-colors hover:text-gray-900"
    >
      <MessageCircle className="h-5 w-5" />
      {badge && (
        <span className="bg-primary-600 absolute -top-2 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </Link>
  );
}
