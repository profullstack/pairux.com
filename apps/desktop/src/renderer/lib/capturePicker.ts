/**
 * Which screen-source chooser to show.
 *
 * `isWayland` is null until the main process answers `platform:info`. That
 * third state matters on Linux where the answer is genuinely unknown; on
 * macOS and Windows it is trivially *not* Wayland, so the caller can pass
 * `false` from the start and skip the "Detecting display server…" spinner
 * that would otherwise flash on every launch.
 */
export function shouldShowInAppSourcePicker(isWayland: boolean | null): boolean {
  return isWayland === false;
}

export function isDisplayServerKnown(isWayland: boolean | null): boolean {
  return isWayland !== null;
}
