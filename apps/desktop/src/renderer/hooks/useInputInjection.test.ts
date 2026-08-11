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
          return Promise.resolve({
            success: true,
            enabled: true,
            backend: 'nut-js',
            backendSupported: true,
            stats: { received: 0, injected: 0, errors: 0 },
          });
        case 'input:disable':
          return Promise.resolve({ success: true, enabled: false });
        case 'input:status':
          return Promise.resolve({
            enabled: false,
            backend: 'nut-js',
            backendSupported: true,
            stats: { received: 0, injected: 0, errors: 0 },
          });
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
      const { result } = renderHook(() => useInputInjection({}));

      expect(result.current.isEnabled).toBe(false);
      expect(result.current.isInitialized).toBe(false);
      expect(result.current.diagnostics).toBeNull();

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isInitialized).toBe(true);
      expect(result.current.diagnostics?.backend).toBe('nut-js');
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
    it('activates the backend before a host announces a control grant', async () => {
      const { result } = renderHook(() => useInputInjection({}));

      await act(async () => {
        expect(await result.current.activate()).toBe(true);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:init', undefined);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:enable', undefined);
      expect(result.current.isEnabled).toBe(true);

      await act(async () => {
        await result.current.deactivate();
      });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:disable', undefined);
      expect(result.current.isEnabled).toBe(false);
    });

    it('should enable injection when enabled prop is true', async () => {
      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('input:enable', undefined);
      expect(result.current.isEnabled).toBe(true);
      expect(result.current.diagnostics?.enabled).toBe(true);
    });

    it('keeps disabled state and stores diagnostics when backend is unavailable', async () => {
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'input:init':
            return Promise.resolve({ success: true });
          case 'input:status':
            return Promise.resolve({
              enabled: false,
              backend: 'wayland-ydotool',
              backendSupported: false,
              reason: 'ydotoold not running',
              details: { hasYdotoolBinary: true, hasYdotoolSocket: false },
              stats: { received: 0, injected: 0, errors: 0 },
            });
          case 'input:enable':
            return Promise.resolve({
              success: true,
              enabled: false,
              backend: 'wayland-ydotool',
              backendSupported: false,
              reason: 'ydotoold not running',
              details: { hasYdotoolBinary: true, hasYdotoolSocket: false },
              stats: { received: 0, injected: 0, errors: 0 },
            });
          case 'input:disable':
            return Promise.resolve({ success: true, enabled: false });
          default:
            return Promise.resolve({ success: true });
        }
      });

      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isEnabled).toBe(false);
      expect(result.current.diagnostics?.backend).toBe('wayland-ydotool');
      expect(result.current.diagnostics?.backendSupported).toBe(false);
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

  // Regression: the hook used to forward the capture track's dimensions as the
  // injection screen size. Those are encoded-stream pixels, not the host's
  // screen geometry, and on a Retina Mac (logical 1440x900, stream 2880x1800)
  // that mapped the centre of the screen to its bottom-right corner and put
  // everything past halfway off the display, so clicks did nothing. The backend
  // reads its own geometry from the OS; the renderer must not override it.
  describe('screen size', () => {
    it('never sends a screen size to the backend', async () => {
      renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const channels = mockElectronAPI.invoke.mock.calls.map(([channel]) => channel);
      expect(channels).not.toContain('input:updateScreenSize');
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

    it('keeps mouse down before mouse up while a pending move batch is slow', async () => {
      let finishMoveBatch: (() => void) | undefined;
      const moveBatchPending = new Promise<void>((resolve) => {
        finishMoveBatch = resolve;
      });

      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'input:init':
            return Promise.resolve({ success: true });
          case 'input:status':
            return Promise.resolve({
              enabled: false,
              backend: 'nut-js',
              backendSupported: true,
              stats: { received: 0, injected: 0, errors: 0 },
            });
          case 'input:enable':
            return Promise.resolve({
              success: true,
              enabled: true,
              backend: 'nut-js',
              backendSupported: true,
              stats: { received: 0, injected: 0, errors: 0 },
            });
          case 'input:injectBatch':
            return moveBatchPending;
          default:
            return Promise.resolve({ success: true });
        }
      });

      const { result } = renderHook(() => useInputInjection({ enabled: true }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const moveEvent: InputEvent = { type: 'mouse', action: 'move', x: 0.4, y: 0.4 };
      const downEvent: InputEvent = {
        type: 'mouse',
        action: 'down',
        button: 'left',
        x: 0.4,
        y: 0.4,
      };
      const upEvent: InputEvent = {
        type: 'mouse',
        action: 'up',
        button: 'left',
        x: 0.4,
        y: 0.4,
      };

      let downPromise: Promise<void>;
      let upPromise: Promise<void>;
      await act(async () => {
        await result.current.injectEvent(moveEvent);
        downPromise = result.current.injectEvent(downEvent);
        upPromise = result.current.injectEvent(upEvent);
        await Promise.resolve();
      });

      const whileMoveIsPending = mockElectronAPI.invoke.mock.calls.filter(
        ([channel]) => channel === 'input:injectBatch' || channel === 'input:inject'
      );
      expect(whileMoveIsPending).toEqual([['input:injectBatch', { events: [moveEvent] }]]);

      finishMoveBatch?.();
      await act(async () => {
        await Promise.all([downPromise!, upPromise!]);
      });

      const injectionCalls = mockElectronAPI.invoke.mock.calls.filter(
        ([channel]) => channel === 'input:injectBatch' || channel === 'input:inject'
      );
      expect(injectionCalls).toEqual([
        ['input:injectBatch', { events: [moveEvent] }],
        ['input:inject', { event: downEvent }],
        ['input:inject', { event: upEvent }],
      ]);
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
