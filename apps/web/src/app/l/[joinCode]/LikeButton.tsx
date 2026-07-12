'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, Loader2 } from 'lucide-react';

interface LikeButtonProps {
  sessionId: string;
  joinCode: string;
  initialLiked: boolean;
  initialCount: number;
}

interface LikeResponse {
  data?: { liked: boolean; like_count: number };
}

export function LikeButton({ sessionId, joinCode, initialLiked, initialCount }: LikeButtonProps) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/like`, {
        method: liked ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/l/${joinCode}`)}`);
        return;
      }
      const body = (await res.json()) as LikeResponse;
      if (res.ok && body.data) {
        setLiked(body.data.liked);
        setCount(body.data.like_count);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      className={
        liked
          ? 'inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60'
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
      )}
      {count}
    </button>
  );
}
