/**
 * Which source a `getDisplayMedia()` call should be granted.
 *
 * Electron's display-media request carries no indication of what the user
 * picked — `request.videoRequested` is a boolean saying only *that* video was
 * asked for. So when the renderer already knows which source the user chose
 * (it showed the in-app picker), it has to tell the main process separately,
 * over `capture:setPreferredSource`, before calling `getDisplayMedia()`.
 *
 * When no preference has been recorded the request is genuinely unattributed:
 * either the renderer deliberately skipped its own picker (Wayland, where the
 * PipeWire portal does the choosing) or capture was restarted mid-session. In
 * that case the first enumerated source is used, which on Wayland *is* the
 * portal's selection because `desktopCapturer.getSources()` drives the portal.
 */

/** Source ids look like `screen:0:0` / `window:1234:0`. */
export interface SelectableSource {
  id: string;
  name: string;
}

let preferredSourceId: string | null = null;

/**
 * Record the source the user picked. Cleared once consumed, so a later
 * unattributed request never silently reuses a stale pick.
 */
export function setPreferredDisplayMediaSource(id: string | null): void {
  preferredSourceId = id;
}

/** Read and clear the recorded preference. */
export function takePreferredDisplayMediaSource(): string | null {
  const id = preferredSourceId;
  preferredSourceId = null;
  return id;
}

/** Test seam. */
export function resetPreferredDisplayMediaSource(): void {
  preferredSourceId = null;
}

/**
 * Choose which enumerated source to grant.
 *
 * A preferred id that is no longer present (the window was closed between the
 * pick and the request) falls back to the first source rather than failing the
 * capture outright.
 */
export function pickDisplayMediaSource<T extends SelectableSource>(
  sources: readonly T[],
  preferredId: string | null
): T | null {
  if (sources.length === 0) return null;

  if (preferredId !== null) {
    const match = sources.find((source) => source.id === preferredId);
    if (match) return match;
  }

  return sources[0] ?? null;
}
