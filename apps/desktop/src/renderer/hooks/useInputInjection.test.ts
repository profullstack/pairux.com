import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { InputEvent } from '@pairux/shared-types';
import { useInputInjection } from './useInputInjection';

// Get the mock API from setup
const mockElectronAPI = (
  window as unknown as {
    electronAPI: {
      invoke: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
  }
).electronAPI;

describe('useInputInjection', () => {
  let emergencyStopCallback: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    emergencyStopCallback = null;

    // Default mock implementations
    mockElectronAPI.invoke.mockImplementation((channel: string) => {
      switch (channel) {
        case 'input:init':
          return Promise.resolve({ success: true });
        case 'input:enable':
          return Promise.resolve({ success: true, enabled: true });
        case 'input:disable':
          return Promise.resolve({ success: true, enabled: false });
        case 'input:inject':
          return Promise.resolve({ success: true });
        case 'input:injectBatch':
          return Promise.resolve({ success: true });
        case 'input:emergencyStop':
          return Promise.resolve({ success: true });
        case 'input:updateScreenSize':
          return Promise.resolve({ success: true });
        default:
          return Promise.resolve({});
      }
    });

    mockElectronAPI.on.mockImplementation((channel: string, callback: () => void) => {
      if (channel === 'input:emergency-stop') {
        emergencyStopCallback = callback;
      }
      return () => {}; // Return unsubscribe function
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with default state', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: false }));

      expect(result.current.isEnabled).toBe(false);
      expect(result.current.isInitialized).toBe(false);

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isInitialized).toBe(true);
    });

    it('should call input:init on mount', async () => {
      renderHook(() => useInputInjection({ enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:init', undefined);
    });

    it('should listen for emergency stop events', async () => {
      renderHook(() => useInputInjection({ enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.on).toHaveBeenCalledWith('input:emergency-stop', expect.any(Function));
    });
  });

  describe('enabling/disabling', () => {
    it('should enable injection when enabled prop is true', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:enable', undefined);
      expect(result.current.isEnabled).toBe(true);
    });

    it('should disable injection when enabled prop changes to false', async () => {
      const { result, rerender } = renderHook(({ enabled }) => useInputInjection({ enabled }), {
        initialProps: { enabled: true },
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isEnabled).toBe(true);

      rerender({ enabled: false });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:disable', undefined);
      expect(result.current.isEnabled).toBe(false);
    });
  });

  describe('screen size updates', () => {
    it('should update screen size when screenSize prop changes', async () => {
      const { rerender } = renderHook(
        ({ screenSize }) => useInputInjection({ enabled: false, screenSize }),
        { initialProps: { screenSize: { width: 1920, height: 1080 } } }
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:updateScreenSize', {
        width: 1920,
        height: 1080,
      });

      rerender({ screenSize: { width: 2560, height: 1440 } });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:updateScreenSize', {
        width: 2560,
        height: 1440,
      });
    });
  });

  describe('injectEvent', () => {
    it('should inject mouse click events immediately', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const event: InputEvent = {
        type: 'mouse',
        action: 'click',
        button: 'left',
        x: 0.5,
        y: 0.5,
      };

      await act(async () => {
        await result.current.injectEvent(event);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:inject', { event });
    });

    it('should batch mouse move events', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const moveEvent1: InputEvent = { type: 'mouse', action: 'move', x: 0.1, y: 0.1 };
      const moveEvent2: InputEvent = { type: 'mouse', action: 'move', x: 0.2, y: 0.2 };

      await act(async () => {
        await result.current.injectEvent(moveEvent1);
        await result.current.injectEvent(moveEvent2);
      });

      // Should not call inject immediately for moves
      expect(mockElectronAPI.invoke).not.toHaveBeenCalledWith('input:inject', expect.anything());

      // Advance timers to flush batch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:injectBatch', {
        events: expect.arrayContaining([moveEvent1, moveEvent2]),
      });
    });

    it('should not inject when disabled', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const event: InputEvent = {
        type: 'mouse',
        action: 'click',
        button: 'left',
        x: 0.5,
        y: 0.5,
      };

      await act(async () => {
        await result.current.injectEvent(event);
      });

      expect(mockElectronAPI.invoke).not.toHaveBeenCalledWith('input:inject', expect.anything());
    });

    it('should flush pending moves before click', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const moveEvent: InputEvent = { type: 'mouse', action: 'move', x: 0.5, y: 0.5 };
      const clickEvent: InputEvent = {
        type: 'mouse',
        action: 'click',
        button: 'left',
        x: 0.5,
        y: 0.5,
      };

      await act(async () => {
        await result.current.injectEvent(moveEvent);
        await result.current.injectEvent(clickEvent);
      });

      // Should have called injectBatch first for the move, then inject for the click
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:injectBatch', {
        events: [moveEvent],
      });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:inject', { event: clickEvent });
    });
  });

  describe('injectBatch', () => {
    it('should inject multiple events in batch', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const events: InputEvent[] = [
        { type: 'mouse', action: 'move', x: 0.1, y: 0.1 },
        { type: 'mouse', action: 'move', x: 0.2, y: 0.2 },
        { type: 'mouse', action: 'click', button: 'left', x: 0.2, y: 0.2 },
      ];

      await act(async () => {
        await result.current.injectBatch(events);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:injectBatch', { events });
    });

    it('should not inject batch when disabled', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const events: InputEvent[] = [{ type: 'mouse', action: 'move', x: 0.1, y: 0.1 }];

      await act(async () => {
        await result.current.injectBatch(events);
      });

      expect(mockElectronAPI.invoke).not.toHaveBeenCalledWith(
        'input:injectBatch',
        expect.anything()
      );
    });
  });

  describe('emergencyStop', () => {
    it('should call emergency stop and disable injection', async () => {
      const onEmergencyStop = vi.fn();
      const { result } = renderHook(() => useInputInjection({ enabled: true, onEmergencyStop }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        await result.current.emergencyStop();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:emergencyStop', undefined);
      expect(result.current.isEnabled).toBe(false);
      expect(onEmergencyStop).toHaveBeenCalled();
    });

    it('should handle emergency stop from main process', async () => {
      const onEmergencyStop = vi.fn();
      const { result } = renderHook(() => useInputInjection({ enabled: true, onEmergencyStop }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isEnabled).toBe(true);

      // Simulate emergency stop from main process
      await act(async () => {
        emergencyStopCallback?.();
      });

      expect(result.current.isEnabled).toBe(false);
      expect(onEmergencyStop).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should disable injection on unmount if enabled', async () => {
      const { unmount } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      unmount();

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:disable', undefined);
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors gracefully', async () => {
      mockElectronAPI.invoke.mockRejectedValueOnce(new Error('Init failed'));

      const { result } = renderHook(() => useInputInjection({ enabled: false }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Should not throw, just log error
      expect(result.current.isInitialized).toBe(false);
    });

    it('should handle injection errors gracefully', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      mockElectronAPI.invoke.mockRejectedValueOnce(new Error('Inject failed'));

      const event: InputEvent = {
        type: 'mouse',
        action: 'click',
        button: 'left',
        x: 0.5,
        y: 0.5,
      };

      // Should not throw
      await act(async () => {
        await expect(result.current.injectEvent(event)).resolves.not.toThrow();
      });
    });
  });
});
