/**
 * What the player remembers between visits, and where.
 *
 * Two different things with two different lifetimes:
 *
 * - **Preferences** (volume, muted, speed) belong to the reader and are the same
 *   on every recording. Setting the volume once per video is the kind of small
 *   tax that makes a site feel unfinished.
 * - **Positions** belong to one recording each. An hour-long live that somebody
 *   watches over two evenings is the normal case, not the exotic one.
 *
 * Both live in localStorage, which means both are per-browser and can vanish:
 * a private window, cleared site data, a different device. Every read is
 * therefore allowed to return nothing and every write is allowed to fail — in
 * some contexts merely *touching* localStorage throws, so the accessor itself
 * is wrapped, not just the parse.
 *
 * Positions are one key holding a map rather than a key per recording. A key
 * per recording grows without bound in the browsers of the people who use the
 * site most, and there is no natural moment to sweep it.
 */

const PREFS_KEY = 'pairux.player.prefs';
const POSITIONS_KEY = 'pairux.player.positions';

/** How many recordings keep a position. Oldest touched is dropped first. */
const MAX_POSITIONS = 60;

export interface PlayerPrefs {
  volume: number;
  muted: boolean;
  rate: number;
}

export interface SavedPosition {
  /** Seconds into the recording. */
  t: number;
  /** Duration when it was saved, so a re-encode can invalidate the offset. */
  d: number;
  /** Epoch ms, used only to decide what to evict. */
  at: number;
}

export const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false, rate: 1 };

/**
 * localStorage if it is usable, else null.
 *
 * `window.localStorage` is a getter that throws outright when site data is
 * blocked, so this cannot be a truthiness check on a property.
 */
function store(explicit?: Storage | null): Storage | null {
  if (explicit !== undefined) return explicit;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full, or blocked. Remembering where somebody was is a convenience; it is
    // never worth breaking playback over.
  }
}

/** Clamp anything that came out of storage back into a range the player can use. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function loadPrefs(storage?: Storage | null): PlayerPrefs {
  const raw = readJson(store(storage), PREFS_KEY) as Partial<PlayerPrefs> | null;
  if (!raw) return { ...DEFAULT_PREFS };
  return {
    volume: clamp(raw.volume, 0, 1, DEFAULT_PREFS.volume),
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_PREFS.muted,
    // A stored 8x from a bad write would be unusable and hard to escape, so the
    // range is enforced on the way in as well as in the UI.
    rate: clamp(raw.rate, 0.25, 4, DEFAULT_PREFS.rate),
  };
}

export function savePrefs(prefs: PlayerPrefs, storage?: Storage | null): void {
  writeJson(store(storage), PREFS_KEY, prefs);
}

/**
 * Read the map, and believe none of it.
 *
 * Anything in localStorage was written by some earlier version of this code, or
 * by a different tab, or by hand. Validating here rather than at each use is
 * what lets the rest of the file treat a SavedPosition as the number it claims
 * to be — an entry that cannot be repaired is simply not returned.
 */
function readPositions(storage: Storage | null): Record<string, SavedPosition> {
  const raw = readJson(storage, POSITIONS_KEY);
  if (!raw || typeof raw !== 'object') return {};

  const positions: Record<string, SavedPosition> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<SavedPosition>;
    if (typeof entry.t !== 'number' || !Number.isFinite(entry.t)) continue;
    positions[key] = {
      t: entry.t,
      d: typeof entry.d === 'number' && Number.isFinite(entry.d) ? entry.d : 0,
      // An entry from before positions carried a timestamp sorts oldest, which
      // is the right guess: it has not been touched by this version yet.
      at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0,
    };
  }
  return positions;
}

export function loadPosition(mediaId: string, storage?: Storage | null): SavedPosition | null {
  return readPositions(store(storage))[mediaId] ?? null;
}

/**
 * Remember where the reader is.
 *
 * Evicts the least recently touched entry rather than the oldest *created*, so
 * a recording somebody returns to weekly outlives one they opened once.
 */
export function savePosition(
  mediaId: string,
  position: { t: number; d: number },
  storage?: Storage | null,
  now: () => number = Date.now
): void {
  const storageRef = store(storage);
  if (!storageRef) return;
  const positions = readPositions(storageRef);
  positions[mediaId] = { t: position.t, d: position.d, at: now() };

  // Most recently touched first, then keep the first MAX_POSITIONS of them.
  const kept = Object.entries(positions)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_POSITIONS);
  writeJson(storageRef, POSITIONS_KEY, Object.fromEntries(kept));
}

export function clearPosition(mediaId: string, storage?: Storage | null): void {
  const storageRef = store(storage);
  if (!storageRef) return;
  const positions = readPositions(storageRef);
  if (!(mediaId in positions)) return;
  const remaining = Object.entries(positions).filter(([key]) => key !== mediaId);
  writeJson(storageRef, POSITIONS_KEY, Object.fromEntries(remaining));
}

/** Don't offer to resume this near the start. */
const RESUME_MIN_SECONDS = 15;
/** Don't offer to resume this near the end — that is a finished recording. */
const RESUME_TAIL_SECONDS = 20;

/**
 * Should this saved position be used at all?
 *
 * Separate from reading it, and pure, because the rule is the whole feature:
 * resuming somebody 4 seconds in is noise, resuming them 6 seconds from the end
 * is worse than useless, and resuming into an offset past the end of a file
 * that has since been re-encoded strands them on a black frame.
 */
export function shouldResume(saved: SavedPosition | null, duration: number): boolean {
  if (!saved) return false;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  // A duration that has moved by more than a second is a different file.
  if (Number.isFinite(saved.d) && saved.d > 0 && Math.abs(saved.d - duration) > 1) return false;
  return saved.t >= RESUME_MIN_SECONDS && saved.t <= duration - RESUME_TAIL_SECONDS;
}
