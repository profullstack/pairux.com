import type { ElectronAPI } from '../../preload';

/**
 * Type-safe access to the Electron API exposed via preload script.
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

/**
 * Get the Electron API.
 * Throws if not running in Electron environment.
 */
export function getElectronAPI(): ElectronAPI {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!window.electronAPI) {
    throw new Error('Not running in Electron environment');
  }
  return window.electronAPI;
}

/**
 * Check if running in Electron environment.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}
