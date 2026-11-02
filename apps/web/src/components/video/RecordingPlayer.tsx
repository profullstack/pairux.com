'use client';

/**
 * The recording player: @profullstack/player, the one player every Profullstack
 * site uses.
 *
 * PairUX's hand-rolled player (`src/lib/player`) became that package: the same
 * control bar, chapters, resume positions, `?t=` deep links, speed, skip,
 * picture-in-picture, share-at-time and television profile, plus auto-hide,
 * fullscreen on iPhone and HLS / MPEG-TS when a recording ever needs them. This
 * file owns a ref, a mount effect and a teardown, and carries readers' saved
 * positions over from the old storage keys.
 *
 * Two things are read from `window` inside the effect rather than from props or
 * `useSearchParams`: the `?t=` deep link and the share URL. Reading them during
 * render would make the server and client markup disagree; reading them on
 * mount cannot, and the player has nothing to do before mount anyway.
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createPlayer, parseTimeParam, type Chapter } from '@profullstack/player';
import '@profullstack/player/player.css';

/**
 * Old key, new key. PairUX's player filed preferences and resume positions
 * under `pairux.player.*`; the package files the same shapes under
 * `profullstack.player.*`. Copied once, never overwriting, so a reader halfway
 * through a recording does not start it again from zero.
 */
const LEGACY_KEYS = [
  ['pairux.player.prefs', 'profullstack.player.prefs'],
  ['pairux.player.positions', 'profullstack.player.positions'],
] as const;

export function migrateLegacyPlayerStorage(storage: Storage | null): void {
  if (!storage) return;
  for (const [from, to] of LEGACY_KEYS) {
    try {
      const old = storage.getItem(from);
      if (old !== null && storage.getItem(to) === null) storage.setItem(to, old);
      if (old !== null) storage.removeItem(from);
    } catch {
      // Private windows and blocked storage throw on touch; nothing to carry.
    }
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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
  const t = useTranslations('video.player');
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;

    migrateLegacyPlayerStorage(localStorageOrNull());
    const params = new URLSearchParams(window.location.search);
    const startAt = parseTimeParam(params.get('t'));

    const handle = createPlayer(root, {
      src,
      media: video,
      mediaId,
      // Spread rather than passed: under exactOptionalPropertyTypes an absent
      // prop and one explicitly set to undefined are different types.
      ...(chapters ? { chapters } : {}),
      ...(poster ? { poster } : {}),
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
        // Controls are on until the player replaces them. If it never runs --
        // a bundle that failed, JavaScript off -- the reader still gets a
        // working player rather than a still frame with no way to start it.
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        src={src}
      >
        {t('unsupported')}
      </video>
    </div>
  );
}
