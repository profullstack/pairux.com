/**
 * Backend selection for the desktop host.
 *
 * The selection logic itself lives in @profullstack/remote-input; this module
 * only supplies the platform facts, which come from Electron-aware detection
 * in ../platform rather than the library's standalone probe.
 */

import {
  createInputBackend as createLibraryInputBackend,
  selectInputBackend as selectLibraryInputBackend,
  type InputBackend,
  type InputBackendKind,
  type InputBackendSelection,
} from '@profullstack/remote-input';
import { detectDisplayServer, type DisplayServer } from '../platform';

export type { InputBackendKind, InputBackendSelection };

export function selectInputBackend(
  platform: NodeJS.Platform,
  displayServer: DisplayServer
): InputBackendKind {
  return selectLibraryInputBackend(platform, displayServer);
}

export function getInputBackendSelection(
  platform: NodeJS.Platform = process.platform,
  displayServer: DisplayServer = detectDisplayServer()
): InputBackendSelection {
  return {
    kind: selectInputBackend(platform, displayServer),
    platform,
    displayServer,
  };
}

export function createInputBackend(selection = getInputBackendSelection()): InputBackend {
  return createLibraryInputBackend(selection);
}
