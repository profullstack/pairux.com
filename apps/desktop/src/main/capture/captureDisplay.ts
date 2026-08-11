/**
 * Which monitor the guest is watching, in coordinates the injector can use.
 *
 * Normalized 0-1 coordinates only mean something relative to a known
 * rectangle. That rectangle used to be implicit — the primary display — so a
 * host sharing their second monitor sent the guest a picture of one screen
 * while their clicks landed on another. The guest aims at a button they can
 * see; the pointer moves somewhere they cannot.
 *
 * Electron's `screen` module reports every display's rectangle on the virtual
 * desktop, and a capture source id carries the display it belongs to, so the
 * two can be joined. Window captures are a different problem: a window moves
 * and resizes while it is being shared, so it is mapped to the display it sits
 * on rather than to the window rectangle. The guest can still reach everything
 * on that screen, which beats being confined to a stale rectangle.
 */

import { screen, desktopCapturer } from 'electron';
import {
  resolveCaptureBounds,
  type CaptureBounds,
  type DisplayRect,
} from '@profullstack/remote-input';

/** Electron's Display, narrowed to what this needs. */
interface DisplayLike {
  id: number;
  bounds: DisplayRect;
}

/**
 * Find the display a capture source is showing.
 *
 * `screen:0:0` style ids do not contain the display id, so the source list has
 * to be consulted for its `display_id`. Returns null when the source is a
 * window whose display cannot be determined, or when the id matches nothing.
 */
export async function findDisplayForSource(sourceId: string | null): Promise<DisplayLike | null> {
  if (!sourceId) return null;

  const displays = screen.getAllDisplays();

  try {
    const types: ('screen' | 'window')[] = sourceId.startsWith('window:') ? ['window'] : ['screen'];
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 0, height: 0 },
    });

    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) return null;

    if (source.display_id) {
      const match = displays.find((display) => String(display.id) === source.display_id);
      if (match) return match;
    }
  } catch (error) {
    console.warn('[Capture] Could not resolve the display for a source', { error });
  }

  return null;
}

/**
 * Resolve a capture source into injector coordinates.
 *
 * `backendPrimary` is the primary display's size as the injection backend
 * measured it, which is not always the logical size Electron reports — see
 * `resolveCaptureBounds`. Returns null to mean "map onto the primary display",
 * which is both the old behaviour and the right fallback.
 */
export async function resolveCaptureBoundsForSource(
  sourceId: string | null,
  backendPrimary: { width: number; height: number } | null
): Promise<CaptureBounds | null> {
  if (!backendPrimary) return null;

  const display = await findDisplayForSource(sourceId);
  if (!display) return null;

  const primary = screen.getPrimaryDisplay();
  // Sharing the primary display is the common case and needs no offset, but
  // going through the same path keeps one code route rather than two.
  return resolveCaptureBounds({
    display: display.bounds,
    primary: primary.bounds,
    backendPrimary,
  });
}
