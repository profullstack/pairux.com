'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Loader2 } from 'lucide-react';

interface SubscribeButtonProps {
  handle: string;
  initialSubscribed: boolean;
  initialCount: number;
}

interface SubResponse {
  data?: { subscribed: boolean; subscriber_count: number };
}

export function SubscribeButton({ handle, initialSubscribed, initialCount }: SubscribeButtonProps) {
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/c/${encodeURIComponent(handle)}/subscribe`, {
        method: subscribed ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/c/${handle}`)}`);
        return;
      }
      const body = (await res.json()) as SubResponse;
      if (res.ok && body.data) {
        setSubscribed(body.data.subscribed);
        setCount(body.data.subscriber_count);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={
          subscribed
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60'
            : 'bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60'
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : subscribed ? (
          <Check className="h-4 w-4" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {subscribed ? 'Subscribed' : 'Subscribe'}
      </button>
      <span className="text-sm text-gray-500">
        {count} {count === 1 ? 'subscriber' : 'subscribers'}
      </span>
    </div>
  );
}
