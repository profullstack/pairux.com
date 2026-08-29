/**
 * The recording player, as one import.
 *
 * `player.ts` is the whole thing; the rest are its pure parts, exported because
 * they are worth testing and reusing on their own — a channel page that wants
 * to print a recording's length should not have to reimplement `formatTime`.
 */

export { createPlayer, type PlayerHandle, type PlayerOptions } from './player';
export { formatTime, formatTimeParam, parseTimeParam } from './time';
export { activeChapter, normalizeChapters, type Chapter, type NormalizedChapter } from './chapters';
export { isTvBrowser, tvBrowserType, uiProfile, type UiProfile } from './tv';
export {
  clearPosition,
  loadPosition,
  loadPrefs,
  savePosition,
  savePrefs,
  shouldResume,
  type PlayerPrefs,
  type SavedPosition,
} from './storage';
