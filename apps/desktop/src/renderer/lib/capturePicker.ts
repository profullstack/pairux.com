/**
 * Which screen-source chooser to show.
 *
 * `isWayland` is null until the main process answers `platform:info`. That
 * third state matters: the in-app picker calls desktopCapturer.getSources(),
 * which on Wayland opens a PipeWire portal session that fails and then
 * conflicts with the real getDisplayMedia() call. Treating "unknown" as "not
 * Wayland" mounts the picker for one render on Wayland hosts and fires that
 * doomed portal request, so wait for the answer instead of assuming X11.
 */
export function shouldShowInAppSourcePicker(isWayland: boolean | null): boolean {
  return isWayland === false;
}

export function isDisplayServerKnown(isWayland: boolean | null): boolean {
  return isWayland !== null;
}
