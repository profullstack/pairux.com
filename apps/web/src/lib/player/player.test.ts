import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatTime, formatTimeParam, parseTimeParam } from './time';
import { activeChapter, normalizeChapters } from './chapters';
import { isTvBrowser, tvBrowserType, uiProfile } from './tv';
import {
  clearPosition,
  loadPosition,
  loadPrefs,
  savePosition,
  savePrefs,
  shouldResume,
} from './storage';
import { createPlayer } from './player';

describe('time', () => {
  it('formats under and over an hour differently', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(83)).toBe('1:23');
    expect(formatTime(3723)).toBe('1:02:03');
  });

  it('never renders NaN at a reader', () => {
    expect(formatTime(NaN)).toBe('--:--');
    expect(formatTime(Infinity)).toBe('--:--');
    expect(formatTime(-5)).toBe('--:--');
  });

  it('parses every spelling of a share link people actually write', () => {
    expect(parseTimeParam('372')).toBe(372);
    expect(parseTimeParam('372s')).toBe(372);
    expect(parseTimeParam('6m12s')).toBe(372);
    expect(parseTimeParam('1h2m3s')).toBe(3723);
    expect(parseTimeParam('6:12')).toBe(372);
    expect(parseTimeParam('1:02:03')).toBe(3723);
    expect(parseTimeParam('1h')).toBe(3600);
  });

  it('rejects what is not a time rather than guessing', () => {
    expect(parseTimeParam('')).toBeNull();
    expect(parseTimeParam(null)).toBeNull();
    expect(parseTimeParam('abc')).toBeNull();
    expect(parseTimeParam('1:2:3:4')).toBeNull();
    expect(parseTimeParam('3s2m')).toBeNull();
    expect(parseTimeParam('-5')).toBeNull();
  });

  it('round-trips a share parameter', () => {
    expect(parseTimeParam(formatTimeParam(372.418))).toBe(372);
    expect(formatTimeParam(-1)).toBe('0');
  });
});

describe('chapters', () => {
  const chapters = [
    { start: 120, title: 'Setup' },
    { start: 0, title: 'Intro' },
    { start: 600, title: 'Deploy' },
  ];

  it('sorts, closes ranges and places marks', () => {
    const result = normalizeChapters(chapters, 900);
    expect(result.map((c) => c.title)).toEqual(['Intro', 'Setup', 'Deploy']);
    expect(result[0]?.end).toBe(120);
    expect(result[2]?.end).toBe(900);
    expect(result[1]?.position).toBeCloseTo(120 / 900);
  });

  it('drops what cannot be drawn', () => {
    const result = normalizeChapters(
      [
        { start: 10, title: 'Kept' },
        { start: 10, title: 'Duplicate second' },
        { start: 5000, title: 'Past the end' },
        { start: -3, title: 'Before the start' },
        { start: 40, title: '   ' },
        { start: NaN, title: 'Not a number' },
      ],
      900
    );
    expect(result.map((c) => c.title)).toEqual(['Kept']);
  });

  it('returns nothing until the duration is known', () => {
    expect(normalizeChapters(chapters, NaN)).toEqual([]);
    expect(normalizeChapters(chapters, 0)).toEqual([]);
  });

  it('has no chapter before the first mark', () => {
    const result = normalizeChapters([{ start: 120, title: 'Setup' }], 900);
    expect(activeChapter(result, 60)).toBeNull();
    expect(activeChapter(result, 130)?.title).toBe('Setup');
    expect(activeChapter([], 130)).toBeNull();
  });
});

describe('tv detection', () => {
  it('knows the living room', () => {
    expect(tvBrowserType('Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit')).toBe('firetv');
    expect(tvBrowserType('Mozilla/5.0 (Linux; Android 9; Android TV) Chrome')).toBe('androidtv');
    expect(tvBrowserType('Mozilla/5.0 (Web0S; Linux/SmartTV)')).toBe('webos');
    expect(isTvBrowser('Roku/DVP-9.10')).toBe(true);
  });

  it('leaves a desktop and a phone alone', () => {
    expect(tvBrowserType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120')).toBeNull();
    expect(isTvBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari')).toBe(false);
    expect(isTvBrowser('')).toBe(false);
    expect(isTvBrowser(null)).toBe(false);
  });

  it('gives a television longer to reach a control, and a bigger step', () => {
    expect(uiProfile(true).hideAfterMs).toBeGreaterThan(uiProfile(false).hideAfterMs);
    expect(uiProfile(true).seekStep).toBeGreaterThan(uiProfile(false).seekStep);
  });
});

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers preferences across recordings', () => {
    savePrefs({ volume: 0.4, muted: true, rate: 1.5 });
    expect(loadPrefs()).toEqual({ volume: 0.4, muted: true, rate: 1.5 });
  });

  it('falls back to defaults on junk rather than throwing', () => {
    localStorage.setItem('pairux.player.prefs', 'not json');
    expect(loadPrefs()).toEqual({ volume: 1, muted: false, rate: 1 });
    localStorage.setItem('pairux.player.prefs', JSON.stringify({ volume: 99, rate: 'fast' }));
    expect(loadPrefs()).toEqual({ volume: 1, muted: false, rate: 1 });
  });

  it('survives storage being unavailable entirely', () => {
    expect(() => savePrefs({ volume: 1, muted: false, rate: 1 }, null)).not.toThrow();
    expect(loadPrefs(null)).toEqual({ volume: 1, muted: false, rate: 1 });
    expect(loadPosition('x', null)).toBeNull();
    expect(() => savePosition('x', { t: 5, d: 10 }, null)).not.toThrow();
    expect(() => clearPosition('x', null)).not.toThrow();
  });

  it('keeps positions per recording and can clear one', () => {
    savePosition('a', { t: 30, d: 600 });
    savePosition('b', { t: 90, d: 600 });
    expect(loadPosition('a')?.t).toBe(30);
    clearPosition('a');
    expect(loadPosition('a')).toBeNull();
    expect(loadPosition('b')?.t).toBe(90);
  });

  it('evicts the least recently touched once it is full', () => {
    let clock = 1000;
    for (let i = 0; i < 70; i += 1) {
      clock += 1000;
      savePosition(`id-${String(i)}`, { t: 10, d: 600 }, undefined, () => clock);
    }
    // The 10 oldest are gone; the newest are not.
    expect(loadPosition('id-0')).toBeNull();
    expect(loadPosition('id-9')).toBeNull();
    expect(loadPosition('id-10')?.t).toBe(10);
    expect(loadPosition('id-69')?.t).toBe(10);
  });

  describe('shouldResume', () => {
    it('resumes somewhere worth resuming', () => {
      expect(shouldResume({ t: 300, d: 600, at: 0 }, 600)).toBe(true);
    });

    it('does not resume a few seconds in, or a few seconds from the end', () => {
      expect(shouldResume({ t: 4, d: 600, at: 0 }, 600)).toBe(false);
      expect(shouldResume({ t: 595, d: 600, at: 0 }, 600)).toBe(false);
    });

    it('refuses an offset saved against a different cut of the file', () => {
      expect(shouldResume({ t: 300, d: 600, at: 0 }, 900)).toBe(false);
    });

    it('has nothing to say without a position or a duration', () => {
      expect(shouldResume(null, 600)).toBe(false);
      expect(shouldResume({ t: 300, d: 600, at: 0 }, NaN)).toBe(false);
    });
  });
});

/**
 * The mounted player.
 *
 * jsdom implements no media pipeline: `duration` is NaN, `play()` is missing and
 * nothing ever fires on its own. So the element is given the handful of
 * properties the player reads, and events are dispatched by hand — which is the
 * honest shape of these tests anyway. They cover the wiring (does pressing this
 * change that) and not the decoding, which is the browser's job and was checked
 * against the real file separately.
 */
describe('createPlayer', () => {
  interface Harness {
    root: HTMLDivElement;
    video: HTMLVideoElement;
    handle: ReturnType<typeof createPlayer>;
  }

  function mount(options: Partial<Parameters<typeof createPlayer>[2]> = {}): Harness {
    const root = document.createElement('div');
    const video = document.createElement('video');
    root.append(video);
    document.body.append(root);

    Object.defineProperty(video, 'duration', { value: 600, writable: true, configurable: true });
    Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
    Object.defineProperty(video, 'buffered', {
      value: { length: 0, start: () => 0, end: () => 0 },
      writable: true,
      configurable: true,
    });
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn(() => {
      Object.defineProperty(video, 'paused', { value: true, configurable: true });
      video.dispatchEvent(new Event('pause'));
    });

    const handle = createPlayer(video, root, { mediaId: 'test', ...options });
    return { root, video, handle };
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  function press(root: HTMLElement, key: string): void {
    root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('replaces the browser controls with its own', () => {
    const { root, video } = mount();
    expect(video.controls).toBe(false);
    expect(root.querySelector('.pux-player__bar')).not.toBeNull();
    expect(root.classList.contains('pux-player')).toBe(true);
  });

  it('renders the clock once metadata lands', () => {
    const { root, video } = mount();
    video.currentTime = 83;
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(root.querySelector('.pux-player__time')?.textContent).toBe('1:23 / 10:00');
  });

  it('seeks with the keyboard, in the desktop step', () => {
    const { root, video } = mount({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120' });
    video.currentTime = 100;
    press(root, 'ArrowRight');
    expect(video.currentTime).toBe(105);
    press(root, 'ArrowLeft');
    expect(video.currentTime).toBe(100);
    press(root, 'l');
    expect(video.currentTime).toBe(110);
    press(root, 'j');
    expect(video.currentTime).toBe(100);
  });

  it('seeks in a bigger step on a television', () => {
    const { root, video } = mount({ userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTKA)' });
    video.currentTime = 100;
    press(root, 'ArrowRight');
    expect(video.currentTime).toBe(110);
    expect(root.classList.contains('pux-player--tv')).toBe(true);
  });

  it('leaves the arrow keys to the control row, so a D-pad can navigate it', () => {
    const { root, video } = mount();
    video.currentTime = 100;
    const button = root.querySelector<HTMLButtonElement>('[data-control="play"]');
    button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(video.currentTime).toBe(100);
  });

  it('never seeks past either end', () => {
    const { root, video } = mount();
    video.currentTime = 3;
    press(root, 'ArrowLeft');
    expect(video.currentTime).toBe(0);
    video.currentTime = 598;
    press(root, 'l');
    expect(video.currentTime).toBe(600);
  });

  // Regression: the bar and the clock were only redrawn on `timeupdate`, which
  // a paused video never fires. Arrowing along a paused recording moved the
  // playhead while the display sat where it was.
  it('redraws the clock when a paused recording is seeked', () => {
    const { root, video } = mount();
    video.currentTime = 50;
    video.dispatchEvent(new Event('loadedmetadata'));
    press(root, 'ArrowRight');
    expect(root.querySelector('.pux-player__time')?.textContent).toBe('0:55 / 10:00');
    expect(root.querySelector<HTMLElement>('.pux-player__played')?.style.width).not.toBe('0%');
  });

  it('redraws after a seek it did not make', () => {
    const { root, video } = mount();
    video.dispatchEvent(new Event('loadedmetadata'));
    video.currentTime = 120;
    video.dispatchEvent(new Event('seeked'));
    expect(root.querySelector('.pux-player__time')?.textContent).toBe('2:00 / 10:00');
  });

  it('jumps to a tenth with the number keys', () => {
    const { root, video } = mount();
    press(root, '5');
    expect(video.currentTime).toBe(300);
    press(root, '0');
    expect(video.currentTime).toBe(0);
  });

  it('plays and pauses with space', () => {
    const { root, video } = mount();
    press(root, ' ');
    expect(video.play).toHaveBeenCalled();
  });

  it('cycles the speed and remembers it', () => {
    const { root, video } = mount();
    const rate = root.querySelector<HTMLButtonElement>('[data-control="rate"]');
    rate?.click();
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.25);
    expect(rate?.textContent).toBe('1.25×');
    expect(loadPrefs().rate).toBe(1.25);
  });

  it('starts a new recording at the remembered volume', () => {
    savePrefs({ volume: 0.25, muted: true, rate: 1.5 });
    const { video } = mount();
    expect(video.volume).toBe(0.25);
    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1.5);
  });

  it('resumes where the reader left off, and offers to start over', () => {
    savePosition('test', { t: 300, d: 600 });
    const { root, video } = mount();
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(300);

    const notice = root.querySelector<HTMLElement>('.pux-player__notice');
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain('5:00');

    root.querySelector<HTMLButtonElement>('.pux-player__notice-action')?.click();
    expect(video.currentTime).toBe(0);
    expect(loadPosition('test')).toBeNull();
  });

  it('prefers an explicit ?t= over a saved position', () => {
    savePosition('test', { t: 300, d: 600 });
    const { video } = mount({ startAt: 42 });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
  });

  it('forgets the position of a recording that finished', () => {
    savePosition('test', { t: 300, d: 600 });
    const { video } = mount();
    video.dispatchEvent(new Event('ended'));
    expect(loadPosition('test')).toBeNull();
  });

  it('draws a mark per chapter and seeks when one is clicked', () => {
    const { root, video } = mount({
      chapters: [
        { start: 0, title: 'Intro' },
        { start: 300, title: 'Deploy' },
      ],
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    const marks = root.querySelectorAll<HTMLButtonElement>('.pux-player__mark');
    expect(marks).toHaveLength(2);
    marks[1]?.click();
    expect(video.currentTime).toBe(300);
  });

  it('names the chapter the reader is in', () => {
    const { root, video } = mount({
      chapters: [
        { start: 0, title: 'Intro' },
        { start: 300, title: 'Deploy' },
      ],
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.currentTime = 400;
    video.dispatchEvent(new Event('timeupdate'));
    expect(root.querySelector('.pux-player__chapter')?.textContent).toBe('Deploy');
  });

  it('offers a share link only when it has one to give', () => {
    const withShare = mount({ shareUrl: (t) => `https://pairux.com/l/X?t=${String(t)}` });
    expect(withShare.root.querySelector('[data-control="share"]')?.hasAttribute('hidden')).toBe(
      false
    );
    document.body.replaceChildren();
    const without = mount({ shareUrl: null });
    expect(without.root.querySelector('[data-control="share"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('drops the controls a television cannot use', () => {
    const { root } = mount({ userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTKA)' });
    // No pointer to hover a volume slider open, and one screen showing one
    // thing, so picture-in-picture means nothing.
    expect(root.querySelector('[data-control="volume"]')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('[data-control="pip"]')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('[data-control="mute"]')?.hasAttribute('hidden')).toBe(false);
  });

  it('explains a blocked load instead of showing a black rectangle', () => {
    const { root, video } = mount();
    Object.defineProperty(video, 'error', {
      value: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check' },
      configurable: true,
    });
    video.dispatchEvent(new Event('error'));
    const notice = root.querySelector<HTMLElement>('.pux-player__notice');
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain('blocked');
    expect(root.classList.contains('pux-player--failed')).toBe(true);
  });

  it('names an ordinary decode failure differently', () => {
    const { root, video } = mount();
    Object.defineProperty(video, 'error', {
      value: { code: 2, message: '' },
      configurable: true,
    });
    video.dispatchEvent(new Event('error'));
    expect(root.querySelector('.pux-player__notice')?.textContent).toContain('connection dropped');
  });

  it('saves the position on the way out and leaves the element clean', () => {
    const { root, video, handle } = mount();
    video.currentTime = 250;
    handle.destroy();
    expect(loadPosition('test')?.t).toBe(250);
    expect(root.querySelector('.pux-player__bar')).toBeNull();
    expect(root.classList.contains('pux-player')).toBe(false);
  });

  it('stops listening once destroyed', () => {
    const { root, video, handle } = mount();
    handle.destroy();
    video.currentTime = 100;
    press(root, 'ArrowRight');
    expect(video.currentTime).toBe(100);
  });
});
