import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui';

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({ settingsOpen: false });
  });

  it('opens and closes the settings overlay', () => {
    expect(useUIStore.getState().settingsOpen).toBe(false);

    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);

    useUIStore.getState().closeSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });
});
