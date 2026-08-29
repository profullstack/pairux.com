/**
 * The recording player.
 *
 * Deliberately plain DOM with no framework in it. PairUX is a React app, but
 * genrewatch.com and tipoffwatch.com are Hono JSX with a vanilla client bundle,
 * and this file is meant to be dropped into all three — the React wrapper in
 * `components/video/RecordingPlayer.tsx` is thirty lines of `useEffect` around
 * exactly this. Anything imported here would have to be imported there too, so
 * nothing is.
 *
 * What it replaces is `<video controls>`, whose control bar is a different
 * shape and a different set of features in every browser, has no speed control
 * on some, no way to skip ten seconds on any, and cannot be reached with a
 * D-pad on a television. What it does NOT replace is the decoding: these are
 * ordinary MP4 files over https that every browser plays natively. There is no
 * demuxer here and there should never be one.
 */

import { activeChapter, normalizeChapters, type Chapter, type NormalizedChapter } from './chapters';
import {
  DEFAULT_PREFS,
  clearPosition,
  loadPosition,
  loadPrefs,
  savePosition,
  savePrefs,
  shouldResume,
  type PlayerPrefs,
} from './storage';
import { formatTime, formatTimeParam, parseTimeParam } from './time';
import { isTvBrowser, uiProfile } from './tv';

export interface PlayerOptions {
  /** Stable key for this recording; what resume positions are filed under. */
  mediaId: string;
  chapters?: readonly Chapter[];
  /**
   * Where the reader arrived pointing, in seconds. Wins over a saved position:
   * somebody followed a link to a moment and that is what they asked for.
   */
  startAt?: number | null;
  /**
   * Builds the "copy link at this time" URL. Omit to drop the button — the
   * embedded player has no address of its own worth handing out.
   */
  shareUrl?: ((seconds: number) => string) | null;
  /** Overridable for tests. */
  userAgent?: string;
  storage?: Storage | null;
  now?: () => number;
}

export interface PlayerHandle {
  destroy: () => void;
  /** Re-render chapter marks after the caller learns them late. */
  setChapters: (chapters: readonly Chapter[]) => void;
}

/** The speeds the button cycles. 1x first so a press away from it always returns. */
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

/** How often a position is written while playing. */
const SAVE_EVERY_MS = 5000;

/** Skip buttons, and what j/l are worth. */
const SKIP_SECONDS = 10;

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  replay:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  back10:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="17" font-size="8" text-anchor="middle" fill="currentColor">10</text></svg>',
  fwd10:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="17" font-size="8" text-anchor="middle" fill="currentColor">10</text></svg>',
  volume:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15 9l6 6m0-6l-6 6" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12h7v5h-7z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0z"/><path d="M8 16a4 4 0 0 1 0-5.7l2-2a4 4 0 0 1 5.7 5.7l-1 1-1.4-1.4 1-1a2 2 0 0 0-2.9-2.9l-2 2A2 2 0 0 0 9.4 14.6L8 16z"/><path d="M16 8a4 4 0 0 1 0 5.7l-2 2A4 4 0 0 1 8.3 10l1-1 1.4 1.4-1 1a2 2 0 0 0 2.9 2.9l2-2A2 2 0 0 0 14.6 9.4L16 8z"/></svg>',
  enterFullscreen:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/></svg>',
  exitFullscreen:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v3H6v2H4V4h5zm6 0h5v5h-2V7h-3V4zM4 15h2v3h3v2H4v-5zm14 3v-3h2v5h-5v-2h3z"/></svg>',
} as const;

interface FullscreenVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/**
 * Every control carries a `data-control` name.
 *
 * It is what the tests select on and what a host site can style or hide without
 * depending on the order buttons happen to sit in — which changes whenever one
 * is added, and which is exactly how a test ends up asserting against
 * picture-in-picture while believing it is looking at the share button.
 */
function iconButton(
  className: string,
  label: string,
  icon: string,
  control: string
): HTMLButtonElement {
  const button = el('button', className, {
    type: 'button',
    'aria-label': label,
    title: label,
    'data-control': control,
  });
  button.innerHTML = icon;
  return button;
}

/**
 * Turn a media error into something a reader can act on.
 *
 * The default is a black rectangle and nothing else, which is how a policy
 * problem spends a week being reported as "the player is broken" — a blocked
 * media load is a console-only event, and the code the element carries is the
 * only in-page evidence there is.
 */
function errorMessage(video: HTMLVideoElement): string {
  const error = video.error;
  const detail = error?.message ?? '';
  // Chrome's wording when a Content-Security-Policy media-src refused the load.
  if (/URL safety check/i.test(detail)) {
    return 'This recording was blocked before it could load. That is a configuration problem on our side, not on yours — please report it.';
  }
  switch (error?.code) {
    case 1:
      return 'Playback was stopped before it started.';
    case 2:
      return 'The connection dropped while loading this recording. Check your network and try again.';
    case 3:
      return 'This recording could not be decoded by your browser.';
    case 4:
      return 'This recording is missing or in a format your browser cannot play.';
    default:
      return 'This recording could not be played.';
  }
}

export function createPlayer(
  video: HTMLVideoElement,
  root: HTMLElement,
  options: PlayerOptions
): PlayerHandle {
  const {
    mediaId,
    startAt = null,
    shareUrl = null,
    storage,
    now = Date.now,
    userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  } = options;

  const isTv = isTvBrowser(userAgent);
  const profile = uiProfile(isTv);
  let chapters: NormalizedChapter[] = [];
  let chapterSource: readonly Chapter[] = options.chapters ?? [];

  root.classList.add('pux-player');
  if (isTv) root.classList.add('pux-player--tv');
  // The container takes focus so keyboard control works the moment somebody
  // clicks the picture, rather than only after they have tabbed to a button.
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');

  // ---------------------------------------------------------------- markup --

  const overlay = iconButton('pux-player__overlay', 'Play', ICONS.play, 'overlay');
  const spinner = el('div', 'pux-player__spinner', { 'aria-hidden': 'true' });
  const notice = el('div', 'pux-player__notice', { role: 'status', 'aria-live': 'polite' });
  notice.hidden = true;
  const noticeText = el('span', 'pux-player__notice-text');
  const noticeAction = el('button', 'pux-player__notice-action', { type: 'button' });
  noticeAction.hidden = true;
  notice.append(noticeText, noticeAction);

  const bar = el('div', 'pux-player__bar');

  const scrub = el('div', 'pux-player__scrub', {
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Seek',
    'aria-valuemin': '0',
    'aria-valuenow': '0',
  });
  const track = el('div', 'pux-player__track');
  const buffered = el('div', 'pux-player__buffered');
  const played = el('div', 'pux-player__played');
  const marks = el('div', 'pux-player__marks', { 'aria-hidden': 'true' });
  const handle = el('div', 'pux-player__handle', { 'aria-hidden': 'true' });
  const tooltip = el('div', 'pux-player__tooltip', { 'aria-hidden': 'true' });
  track.append(buffered, played, marks, handle);
  scrub.append(track, tooltip);

  const row = el('div', 'pux-player__row');
  const playButton = iconButton('pux-player__btn', 'Play', ICONS.play, 'play');
  const backButton = iconButton(
    'pux-player__btn',
    `Back ${String(SKIP_SECONDS)} seconds`,
    ICONS.back10,
    'back'
  );
  const forwardButton = iconButton(
    'pux-player__btn',
    `Forward ${String(SKIP_SECONDS)} seconds`,
    ICONS.fwd10,
    'forward'
  );

  const volumeWrap = el('div', 'pux-player__volume');
  const muteButton = iconButton('pux-player__btn', 'Mute', ICONS.volume, 'mute');
  const volumeInput = el('input', 'pux-player__volume-input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    'aria-label': 'Volume',
    'data-control': 'volume',
  });
  volumeWrap.append(muteButton, volumeInput);

  const timeLabel = el('div', 'pux-player__time');
  const chapterLabel = el('div', 'pux-player__chapter');
  const spacer = el('div', 'pux-player__spacer');

  const rateButton = el('button', 'pux-player__btn pux-player__btn--text', {
    type: 'button',
    'aria-label': 'Playback speed',
    title: 'Playback speed',
    'data-control': 'rate',
  });
  const shareButton = iconButton('pux-player__btn', 'Copy link at this time', ICONS.link, 'share');
  const pipButton = iconButton('pux-player__btn', 'Picture in picture', ICONS.pip, 'pip');
  const fullscreenButton = iconButton(
    'pux-player__btn',
    'Fullscreen',
    ICONS.enterFullscreen,
    'fullscreen'
  );

  row.append(
    playButton,
    backButton,
    forwardButton,
    volumeWrap,
    timeLabel,
    chapterLabel,
    spacer,
    rateButton,
    shareButton,
    pipButton,
    fullscreenButton
  );
  bar.append(scrub, row);
  root.append(overlay, spinner, notice, bar);

  // A television has no pointer to hover a volume slider open, and no reliable
  // way to drag one; the mute button and the volume keys are the whole control
  // there. Picture-in-picture is equally meaningless on a screen showing one
  // thing at a time.
  if (isTv) {
    volumeInput.hidden = true;
    pipButton.hidden = true;
  }
  if (!shareUrl) shareButton.hidden = true;
  if (typeof document === 'undefined' || !document.pictureInPictureEnabled) pipButton.hidden = true;

  // ----------------------------------------------------------------- state --

  const cleanups: (() => void)[] = [];
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = 0;
  let scrubbing = false;
  let destroyed = false;

  function on(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => {
      target.removeEventListener(type, handler, opts);
    });
  }

  function showNotice(message: string, action?: { label: string; run: () => void }): void {
    noticeText.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (action) {
      noticeAction.hidden = false;
      noticeAction.textContent = action.label;
      noticeAction.onclick = () => {
        action.run();
        hideNotice();
      };
    } else {
      noticeAction.hidden = true;
      noticeAction.onclick = null;
    }
    // Long enough to read and reach, then out of the way of the picture.
    noticeTimer = setTimeout(hideNotice, action ? 9000 : 4000);
  }

  function hideNotice(): void {
    notice.hidden = true;
    noticeAction.onclick = null;
  }

  // ---------------------------------------------------------------- render --

  function renderMarks(): void {
    marks.replaceChildren();
    for (const chapter of chapters) {
      const mark = el('button', 'pux-player__mark', {
        type: 'button',
        'aria-label': `${chapter.title}, ${formatTime(chapter.start)}`,
        title: chapter.title,
      });
      mark.style.left = `${String(chapter.position * 100)}%`;
      mark.addEventListener('click', (event) => {
        event.stopPropagation();
        video.currentTime = chapter.start;
      });
      marks.append(mark);
    }
  }

  function rebuildChapters(): void {
    chapters = normalizeChapters(chapterSource, video.duration);
    renderMarks();
    renderProgress();
  }

  function renderProgress(): void {
    const duration = video.duration;
    const current = video.currentTime;
    const known = Number.isFinite(duration) && duration > 0;
    const fraction = known ? Math.min(1, Math.max(0, current / duration)) : 0;

    played.style.width = `${String(fraction * 100)}%`;
    handle.style.left = `${String(fraction * 100)}%`;

    if (video.buffered.length > 0 && known) {
      // The range covering the playhead, which is the only one that tells the
      // reader whether the next few seconds are already here.
      let end = 0;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= current && video.buffered.end(i) >= current) {
          end = video.buffered.end(i);
          break;
        }
      }
      buffered.style.width = `${String(Math.min(1, end / duration) * 100)}%`;
    }

    timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    scrub.setAttribute('aria-valuenow', String(Math.floor(current)));
    if (known) scrub.setAttribute('aria-valuemax', String(Math.floor(duration)));
    scrub.setAttribute(
      'aria-valuetext',
      known ? `${formatTime(current)} of ${formatTime(duration)}` : formatTime(current)
    );

    const chapter = activeChapter(chapters, current);
    chapterLabel.textContent = chapter ? chapter.title : '';
  }

  function renderPlayState(): void {
    const isPlaying = !video.paused && !video.ended;
    const ended = video.ended;
    const icon = ended ? ICONS.replay : isPlaying ? ICONS.pause : ICONS.play;
    const label = ended ? 'Play again' : isPlaying ? 'Pause' : 'Play';
    playButton.innerHTML = icon;
    playButton.setAttribute('aria-label', label);
    playButton.title = label;
    overlay.innerHTML = icon;
    overlay.setAttribute('aria-label', label);
    root.classList.toggle('pux-player--playing', isPlaying);
    root.classList.toggle('pux-player--ended', ended);
    if (!isPlaying) showControls(false);
  }

  function renderVolume(): void {
    const off = video.muted || video.volume === 0;
    muteButton.innerHTML = off ? ICONS.muted : ICONS.volume;
    muteButton.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
    muteButton.setAttribute('aria-pressed', off ? 'true' : 'false');
    volumeInput.value = String(off ? 0 : video.volume);
  }

  function renderRate(): void {
    rateButton.textContent = `${String(video.playbackRate)}×`;
    rateButton.setAttribute('aria-label', `Playback speed, ${String(video.playbackRate)} times`);
  }

  // --------------------------------------------------------------- controls --

  function showControls(autoHide = true): void {
    root.classList.add('pux-player--controls');
    if (hideTimer) clearTimeout(hideTimer);
    if (!autoHide) return;
    hideTimer = setTimeout(() => {
      // Never hide the controls out from under the reader's own focus: on a
      // television that is the only thing telling them where they are.
      if (video.paused || !root.contains(document.activeElement)) {
        if (!video.paused) root.classList.remove('pux-player--controls');
      }
    }, profile.hideAfterMs);
  }

  function togglePlay(): void {
    if (video.paused || video.ended) void video.play().catch(() => undefined);
    else video.pause();
  }

  function seekBy(delta: number): void {
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(duration, Math.max(0, video.currentTime + delta));
    // Redrawn here and not left to `timeupdate`, which a PAUSED video never
    // fires: without this, arrowing along a paused recording moves the playhead
    // while the bar and the clock sit exactly where they were.
    renderProgress();
    showControls();
  }

  function seekToFraction(fraction: number): void {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.min(1, Math.max(0, fraction)) * video.duration;
    renderProgress();
  }

  function fractionFromPointer(clientX: number): number {
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return (clientX - rect.left) / rect.width;
  }

  function cycleRate(step: number): void {
    const index = RATES.indexOf(video.playbackRate as (typeof RATES)[number]);
    const next = RATES[(index + step + RATES.length) % RATES.length] ?? 1;
    video.playbackRate = next;
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await root.requestFullscreen();
    } catch {
      // iPhone Safari has no element fullscreen -- `requestFullscreen` is not
      // there to call -- but the video element has one of its own. Every other
      // browser's refusal lands here too, and none of them is worth an error
      // message: the reader pressed a button and can press it again.
      (video as FullscreenVideo).webkitEnterFullscreen?.();
    }
  }

  async function togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      showNotice('Picture in picture is not available here.');
    }
  }

  async function copyLink(): Promise<void> {
    if (!shareUrl) return;
    const at = Math.floor(video.currentTime);
    const url = shareUrl(at);
    try {
      await navigator.clipboard.writeText(url);
      showNotice(`Link copied, starting at ${formatTime(at)}.`);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (no
      // permission, an insecure context, a browser that wants a fresher
      // gesture). Showing the URL is still an answer.
      showNotice(url);
    }
  }

  // ----------------------------------------------------------------- events --

  on(video, 'loadedmetadata', () => {
    rebuildChapters();
    renderProgress();

    // Where to begin. An explicit ?t= is an instruction; a saved position is a
    // guess, and one the reader is told about and can undo.
    const wanted = typeof startAt === 'number' && startAt > 0 ? startAt : null;
    if (wanted !== null && Number.isFinite(video.duration) && wanted < video.duration) {
      video.currentTime = wanted;
      return;
    }
    const saved = loadPosition(mediaId, storage);
    if (shouldResume(saved, video.duration) && saved) {
      video.currentTime = saved.t;
      showNotice(`Resumed at ${formatTime(saved.t)}.`, {
        label: 'Start over',
        run: () => {
          video.currentTime = 0;
          clearPosition(mediaId, storage);
        },
      });
    }
  });

  on(video, 'timeupdate', () => {
    if (!scrubbing) renderProgress();
    const current = video.currentTime;
    const duration = video.duration;
    if (now() - lastSaved < SAVE_EVERY_MS) return;
    lastSaved = now();
    if (Number.isFinite(duration) && duration > 0) {
      savePosition(mediaId, { t: current, d: duration }, storage, now);
    }
  });

  on(video, 'progress', renderProgress);
  // Catches the seeks this player did not make: a chapter mark, the media keys,
  // another script, and the browser's own snap to the nearest keyframe.
  on(video, 'seeked', renderProgress);
  on(video, 'seeking', renderProgress);
  on(video, 'durationchange', rebuildChapters);
  on(video, 'play', renderPlayState);
  on(video, 'pause', () => {
    renderPlayState();
    if (Number.isFinite(video.duration) && video.duration > 0) {
      savePosition(mediaId, { t: video.currentTime, d: video.duration }, storage, now);
    }
  });
  on(video, 'ended', () => {
    renderPlayState();
    // A finished recording has no position worth keeping; leaving one means
    // every future visit resumes 3 seconds from the end.
    clearPosition(mediaId, storage);
  });
  on(video, 'volumechange', () => {
    renderVolume();
    savePrefs({ volume: video.volume, muted: video.muted, rate: video.playbackRate }, storage);
  });
  on(video, 'ratechange', () => {
    renderRate();
    savePrefs({ volume: video.volume, muted: video.muted, rate: video.playbackRate }, storage);
  });
  on(video, 'waiting', () => {
    root.classList.add('pux-player--buffering');
  });
  on(video, 'playing', () => {
    root.classList.remove('pux-player--buffering');
  });
  on(video, 'canplay', () => {
    root.classList.remove('pux-player--buffering');
  });
  on(video, 'error', () => {
    root.classList.remove('pux-player--buffering');
    root.classList.add('pux-player--failed');
    showNotice(errorMessage(video));
  });

  on(overlay, 'click', togglePlay);
  on(playButton, 'click', togglePlay);
  on(backButton, 'click', () => {
    seekBy(-SKIP_SECONDS);
  });
  on(forwardButton, 'click', () => {
    seekBy(SKIP_SECONDS);
  });
  on(muteButton, 'click', () => {
    video.muted = !video.muted;
  });
  on(volumeInput, 'input', () => {
    video.volume = Number(volumeInput.value);
    video.muted = Number(volumeInput.value) === 0;
  });
  on(rateButton, 'click', () => {
    cycleRate(1);
  });
  on(shareButton, 'click', () => void copyLink());
  on(pipButton, 'click', () => void togglePip());
  on(fullscreenButton, 'click', () => void toggleFullscreen());

  on(document, 'fullscreenchange', () => {
    const isFull = document.fullscreenElement === root;
    root.classList.toggle('pux-player--fullscreen', isFull);
    fullscreenButton.innerHTML = isFull ? ICONS.exitFullscreen : ICONS.enterFullscreen;
    fullscreenButton.setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Fullscreen');
  });

  // Scrubbing. Pointer events rather than mouse, so a touch drag and a pen work
  // without a second code path; capture so a drag that leaves the bar still
  // tracks, which is most drags.
  on(scrub, 'pointerdown', (event) => {
    const pointer = event as PointerEvent;
    scrubbing = true;
    scrub.setPointerCapture(pointer.pointerId);
    seekToFraction(fractionFromPointer(pointer.clientX));
    renderProgress();
  });
  on(scrub, 'pointermove', (event) => {
    const pointer = event as PointerEvent;
    const fraction = fractionFromPointer(pointer.clientX);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      tooltip.textContent = formatTime(Math.max(0, Math.min(1, fraction)) * video.duration);
      tooltip.style.left = `${String(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    }
    if (!scrubbing) return;
    seekToFraction(fraction);
    renderProgress();
  });
  const endScrub = (event: Event): void => {
    if (!scrubbing) return;
    scrubbing = false;
    const pointer = event as PointerEvent;
    if (scrub.hasPointerCapture(pointer.pointerId)) scrub.releasePointerCapture(pointer.pointerId);
  };
  on(scrub, 'pointerup', endScrub);
  on(scrub, 'pointercancel', endScrub);

  on(root, 'pointermove', () => {
    showControls();
  });
  on(root, 'pointerleave', () => {
    if (!video.paused) root.classList.remove('pux-player--controls');
  });
  on(root, 'focusin', () => {
    showControls();
  });

  /**
   * Keys.
   *
   * The arrow keys are the awkward ones: they are the seek and volume controls
   * for somebody watching, and they are how a D-pad reader moves between the
   * buttons in the bar. So arrows are only ours when focus is on the picture or
   * the scrubber — once focus is in the control row the browser's own focus
   * movement wins, which is what makes the bar usable from a sofa.
   */
  on(root, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const target = event.target as HTMLElement | null;
    const inRow = target ? row.contains(target) : false;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (inRow && arrows.includes(key)) return;

    switch (key) {
      case ' ':
      case 'k':
      case 'Enter':
        // Enter on a button is that button's own business.
        if (key === 'Enter' && target?.closest('button')) return;
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seekBy(-profile.seekStep);
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekBy(profile.seekStep);
        break;
      case 'j':
        seekBy(-SKIP_SECONDS);
        break;
      case 'l':
        seekBy(SKIP_SECONDS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        video.muted = false;
        showControls();
        break;
      case 'ArrowDown':
        event.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        showControls();
        break;
      case 'm':
        video.muted = !video.muted;
        showControls();
        break;
      case 'f':
        void toggleFullscreen();
        break;
      case 'p':
        if (!pipButton.hidden) void togglePip();
        break;
      case 'Home':
        event.preventDefault();
        video.currentTime = 0;
        break;
      case 'End':
        event.preventDefault();
        if (Number.isFinite(video.duration)) video.currentTime = video.duration;
        break;
      case '<':
      case ',':
        cycleRate(-1);
        showControls();
        break;
      case '>':
      case '.':
        cycleRate(1);
        showControls();
        break;
      default:
        // 0–9 jump to that tenth, the one shortcut everybody already knows.
        if (/^[0-9]$/.test(key) && !inRow) {
          event.preventDefault();
          seekToFraction(Number(key) / 10);
        }
    }
  });

  // Leaving the page is the most common way a reader stops watching, and it
  // fires no pause. pagehide rather than unload: it is the one that fires on
  // iOS and on a back/forward navigation.
  const persist = (): void => {
    if (Number.isFinite(video.duration) && video.duration > 0 && !video.ended) {
      savePosition(mediaId, { t: video.currentTime, d: video.duration }, storage, now);
    }
  };
  on(window, 'pagehide', persist);

  // ------------------------------------------------------------------ init --

  const prefs: PlayerPrefs = loadPrefs(storage);
  video.volume = prefs.volume;
  video.muted = prefs.muted;
  video.playbackRate = prefs.rate === 0 ? DEFAULT_PREFS.rate : prefs.rate;
  // The browser's own controls would be a second, differently-shaped set of the
  // same buttons sitting on top of these.
  video.controls = false;

  renderPlayState();
  renderVolume();
  renderRate();
  renderProgress();
  rebuildChapters();
  showControls(false);

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      persist();
      if (hideTimer) clearTimeout(hideTimer);
      if (noticeTimer) clearTimeout(noticeTimer);
      for (const cleanup of cleanups) cleanup();
      overlay.remove();
      spinner.remove();
      notice.remove();
      bar.remove();
      root.classList.remove(
        'pux-player',
        'pux-player--tv',
        'pux-player--controls',
        'pux-player--playing',
        'pux-player--ended',
        'pux-player--buffering',
        'pux-player--failed',
        'pux-player--fullscreen'
      );
    },
    setChapters(next: readonly Chapter[]): void {
      chapterSource = next;
      rebuildChapters();
    },
  };
}

export { parseTimeParam, formatTime, formatTimeParam };
export type { Chapter };
