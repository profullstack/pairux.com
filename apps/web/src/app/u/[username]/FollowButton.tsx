'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Loader2 } from 'lucide-react';

interface FollowButtonProps {
  username: string;
  initialFollowing: boolean;
  initialCount: number;
}

interface FollowResponse {
  data?: { following: boolean; follower_count: number };
}

/**
 * Follow / unfollow a creator. Followers with notifications enabled get a push
 * when the creator goes live. Unauthenticated users are sent to login first.
 */
export function FollowButton({ username, initialFollowing, initialCount }: FollowButtonProps) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/u/${encodeURIComponent(username)}/follow`, {
        method: following ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/u/${username}`)}`);
        return;
      }
      const body = (await res.json()) as FollowResponse;
      if (res.ok && body.data) {
        setFollowing(body.data.following);
        setCount(body.data.follower_count);
      }
    } catch {
      // ignore — leave state unchanged
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={
          following
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60'
            : 'bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60'
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : following ? (
          <Check className="h-4 w-4" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {following ? 'Following' : 'Follow'}
      </button>
      <span className="text-sm text-gray-500">
        {count} {count === 1 ? 'follower' : 'followers'}
      </span>
    </div>
  );
}
