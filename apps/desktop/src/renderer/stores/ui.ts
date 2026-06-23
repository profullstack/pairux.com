import { create } from 'zustand';

/**
 * Transient UI state that must survive route changes.
 *
 * Settings is shown as an overlay (not a sibling route) so opening it does NOT
 * unmount the active session on Home — navigating to a `/settings` route tore
 * the HomePage subtree down, which ran CapturePreview's unmount cleanup
 * (`stopHosting`) and ended the live session.
 */
interface UIState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  openSettings: () => {
    set({ settingsOpen: true });
  },
  closeSettings: () => {
    set({ settingsOpen: false });
  },
}));
