import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before electron (dependencies matter)
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  default: { existsSync: vi.fn().mockReturnValue(false) },
}));

// Mock electron - all mock values must be inline for hoisting
vi.mock('electron', () => {
  const mockTrayInstance = {
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    setImage: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    displayBalloon: vi.fn(),
  };

  return {
    Tray: vi.fn().mockImplementation(() => mockTrayInstance),
    Menu: {
      buildFromTemplate: vi.fn().mockReturnValue({}),
    },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({}),
      createFromBuffer: vi.fn().mockReturnValue({}),
      createEmpty: vi.fn().mockReturnValue({}),
    },
    app: {
      isPackaged: false,
      getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
    },
    BrowserWindow: {
      getAllWindows: vi.fn().mockReturnValue([]),
    },
  };
});

import { Tray, Menu } from 'electron';
import {
  initializeTray,
  setTrayStatus,
  setTraySession,
  getTrayStatus,
  getTraySession,
  destroyTray,
  isTrayInitialized,
  type SessionInfo,
} from './tray';

describe('Tray Module', () => {
  const mockCallbacks = {
    onShowWindow: vi.fn(),
    onEndSession: vi.fn(),
    onTogglePause: vi.fn(),
    onCopyJoinCode: vi.fn(),
    onQuit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset tray state by destroying if initialized
    if (isTrayInitialized()) {
      destroyTray();
    }
  });

  afterEach(() => {
    destroyTray();
  });

  describe('initializeTray', () => {
    it('should create a tray instance', () => {
      initializeTray(mockCallbacks);

      expect(isTrayInitialized()).toBe(true);
      expect(Tray).toHaveBeenCalled();
    });

    it('should set initial context menu', () => {
      initializeTray(mockCallbacks);

      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });
  });

  describe('setTrayStatus', () => {
    beforeEach(() => {
      initializeTray(mockCallbacks);
    });

    it('should update status to active', () => {
      setTrayStatus('active');

      expect(getTrayStatus()).toBe('active');
    });

    it('should update status to paused', () => {
      setTrayStatus('paused');

      expect(getTrayStatus()).toBe('paused');
    });

    it('should update status to error', () => {
      setTrayStatus('error');

      expect(getTrayStatus()).toBe('error');
    });

    it('should update status to idle', () => {
      setTrayStatus('active');
      setTrayStatus('idle');

      expect(getTrayStatus()).toBe('idle');
    });
  });

  describe('setTraySession', () => {
    beforeEach(() => {
      initializeTray(mockCallbacks);
    });

    it('should set session info', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'host',
      };

      setTraySession(session);

      expect(getTraySession()).toEqual(session);
    });

    it('should update status based on session status', () => {
      const activeSession: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'host',
      };

      setTraySession(activeSession);

      expect(getTrayStatus()).toBe('active');
    });

    it('should set status to paused when session is paused', () => {
      const pausedSession: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'paused',
        role: 'host',
      };

      setTraySession(pausedSession);

      expect(getTrayStatus()).toBe('paused');
    });

    it('should set status to idle when session is null', () => {
      setTrayStatus('active');
      setTraySession(null);

      expect(getTrayStatus()).toBe('idle');
      expect(getTraySession()).toBeNull();
    });

    it('should rebuild context menu when session changes', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'host',
      };

      const initialCallCount = vi.mocked(Menu.buildFromTemplate).mock.calls.length;
      setTraySession(session);

      expect(vi.mocked(Menu.buildFromTemplate).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('destroyTray', () => {
    it('should destroy the tray instance', () => {
      initializeTray(mockCallbacks);

      expect(isTrayInitialized()).toBe(true);

      destroyTray();

      expect(isTrayInitialized()).toBe(false);
    });

    it('should not throw if tray not initialized', () => {
      expect(() => destroyTray()).not.toThrow();
    });
  });

  describe('context menu items', () => {
    beforeEach(() => {
      initializeTray(mockCallbacks);
    });

    it('should include PairUX header', () => {
      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ label: 'PairUX', enabled: false })])
      );
    });

    it('should include "No active session" when no session', () => {
      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'No active session', enabled: false }),
        ])
      );
    });

    it('should include "Show Window" action', () => {
      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ label: 'Show Window' })])
      );
    });

    it('should include "Quit PairUX" action', () => {
      expect(Menu.buildFromTemplate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ label: 'Quit PairUX' })])
      );
    });

    it('should include session controls for host', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'host',
      };

      setTraySession(session);

      const lastCall = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0];
      expect(lastCall).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Pause Session' }),
          expect.objectContaining({ label: 'End Session' }),
        ])
      );
    });

    it('should show Resume Session when paused', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'paused',
        role: 'host',
      };

      setTraySession(session);

      const lastCall = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0];
      expect(lastCall).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'Resume Session' })])
      );
    });

    it('should not include session controls for viewer', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'viewer',
      };

      setTraySession(session);

      const lastCall = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0];
      const pauseItem = lastCall?.find(
        (item: { label?: string }) => item.label === 'Pause Session'
      );
      const endItem = lastCall?.find((item: { label?: string }) => item.label === 'End Session');

      expect(pauseItem).toBeUndefined();
      expect(endItem).toBeUndefined();
    });

    it('should include join code with copy action', () => {
      const session: SessionInfo = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active',
        role: 'host',
      };

      setTraySession(session);

      const lastCall = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0];
      expect(lastCall).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'Join Code: ABC123' })])
      );
    });
  });
});
