'use client';

/**
 * React's half of the recording player.
 *
 * Deliberately thin. Everything that decides how the player behaves lives in
 * `@/lib/player`, which has no framework in it, so that genrewatch.com and
 * tipoffwatch.com — Hono JSX with a vanilla client bundle — can use the same
 * player rather than a second one that drifts. This file exists to own a ref, a
 * mount effect and a teardown.
 *
 * Two things are read from `window` inside the effect rather than from props or
 * `useSearchParams`: the `?t=` deep link and the share URL. Reading them during
 * render would make the server and client markup disagree; reading them on
 * mount cannot, and the player has nothing to do before mount anyway.
 */

import { useEffect, useRef } from 'react';
import { createPlayer, parseTimeParam, type Chapter } from '@/lib/player';
import '@/lib/player/player.css';

interface RecordingPlayerProps {
  src: string;
  /** Stable key for resume positions — the recording, not the page. */
  mediaId: string;
  poster?: string | null;
  chapters?: Chapter[];
  /**
   * Whether to offer "copy link at this time". Off inside an embed: the iframe
   * has no address a reader could usefully paste.
   */
  shareable?: boolean;
  className?: string;
}

export function RecordingPlayer({
  src,
  mediaId,
  poster,
  chapters,
  shareable = true,
  className,
}: RecordingPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;

    const params = new URLSearchParams(window.location.search);
    const startAt = parseTimeParam(params.get('t'));

    const handle = createPlayer(video, root, {
      mediaId,
      // Spread rather than passed: under exactOptionalPropertyTypes an absent
      // prop and one explicitly set to undefined are different types.
      ...(chapters ? { chapters } : {}),
      startAt,
      shareUrl: shareable
        ? (seconds: number) => {
            const url = new URL(window.location.href);
            url.searchParams.set('t', String(seconds));
            url.hash = '';
            return url.toString();
          }
        : null,
    });

    return () => {
      handle.destroy();
    };
    // `chapters` is intentionally not a dependency: rebuilding the whole player
    // on a new array identity would lose the reader's position. Chapters that
    // arrive later go through the handle's setChapters instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, shareable, src]);

  return (
    <div ref={rootRef} className={className}>
      <video
        ref={videoRef}
        // Controls are on until the script that replaces them runs. If it never
        // runs -- a bundle that failed, JavaScript off -- the reader still gets
        // a working player rather than a still frame with no way to start it.
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        src={src}
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
}
