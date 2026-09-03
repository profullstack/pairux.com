import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsAndroid, Platform } from 'react-native';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { useScreenShare } from './useScreenShare';
import { emitAppStateChange } from '../test/setup';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createCapture() {
  const endedListeners = new Set<() => void>();
  const track = {
    id: 'screen-video',
    kind: 'video',
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'ended') endedListeners.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'ended') endedListeners.delete(listener);
    }),
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: vi.fn(() => [track]),
  } as unknown as MediaStream;

  return {
    stream,
    track,
    end: () => {
      for (const listener of endedListeners) listener();
    },
  };
}

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.mocked(mediaDevices.getDisplayMedia).mockReset();
    vi.mocked(PermissionsAndroid.request)
      .mockReset()
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  });

  it('requests Android 13 notification permission before starting capture', async () => {
    Object.assign(Platform, { OS: 'android', Version: 33 });
    const capture = createCapture();
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });

    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    expect(vi.mocked(PermissionsAndroid.request).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mediaDevices.getDisplayMedia).mock.invocationCallOrder[0]
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([PermissionsAndroid.RESULTS.DENIED, PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN])(
    'continues screen capture when notification permission is %s',
    async (permission) => {
      Object.assign(Platform, { OS: 'android', Version: 34 });
      vi.mocked(PermissionsAndroid.request).mockResolvedValue(permission);
      const capture = createCapture();
      vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);
      const publishStream = vi.fn().mockResolvedValue(undefined);
      const unpublishStream = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

      await act(async () => {
        await expect(result.current.start()).resolves.toBe(true);
      });

      expect(result.current.state).toBe('active');
      expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    }
  );

  it('continues screen capture when the notification permission request throws', async () => {
    Object.assign(Platform, { OS: 'android', Version: 33 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(PermissionsAndroid.request).mockRejectedValue(new Error('permission API failed'));
    const capture = createCapture();
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });

    expect(result.current.state).toBe('active');
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Android 12', { OS: 'android', Version: 32 }],
    ['iOS', { OS: 'ios', Version: 18 }],
  ])('does not request notification permission on %s', async (_label, platform) => {
    Object.assign(Platform, platform);
    const capture = createCapture();
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });

    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  });

  it('does not start capture if stop wins while notification permission is pending', async () => {
    Object.assign(Platform, { OS: 'android', Version: 33 });
    const permission = deferred<Awaited<ReturnType<typeof PermissionsAndroid.request>>>();
    vi.mocked(PermissionsAndroid.request).mockReturnValue(permission.promise);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.stop();
    });

    permission.resolve(PermissionsAndroid.RESULTS.GRANTED);
    await act(async () => {
      await expect(startPromise).resolves.toBe(false);
    });

    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('ignores the transient Android background event from the notification prompt', async () => {
    Object.assign(Platform, { OS: 'android', Version: 33 });
    const permission = deferred<Awaited<ReturnType<typeof PermissionsAndroid.request>>>();
    vi.mocked(PermissionsAndroid.request).mockReturnValue(permission.promise);
    const capture = createCapture();
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1));
    act(() => {
      emitAppStateChange('background');
    });
    expect(result.current.state).toBe('requesting');

    await act(async () => {
      permission.resolve(PermissionsAndroid.RESULTS.GRANTED);
      emitAppStateChange('active');
      await expect(startPromise).resolves.toBe(true);
    });
    expect(result.current.state).toBe('active');
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it('ignores the transient Android background event from MediaProjection consent', async () => {
    Object.assign(Platform, { OS: 'android', Version: 32 });
    const capture = createCapture();
    const captureRequest = deferred<MediaStream>();
    vi.mocked(mediaDevices.getDisplayMedia).mockReturnValue(captureRequest.promise);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1));
    act(() => {
      emitAppStateChange('background');
    });
    expect(result.current.state).toBe('requesting');

    await act(async () => {
      captureRequest.resolve(capture.stream);
      emitAppStateChange('active');
      await expect(startPromise).resolves.toBe(true);
    });

    expect(result.current.state).toBe('active');
    expect(publishStream).toHaveBeenCalledWith(capture.stream);
  });

  it('abandons capture when Android stays backgrounded after MediaProjection consent', async () => {
    vi.useFakeTimers();
    Object.assign(Platform, { OS: 'android', Version: 32 });
    const capture = createCapture();
    const captureRequest = deferred<MediaStream>();
    vi.mocked(mediaDevices.getDisplayMedia).mockReturnValue(captureRequest.promise);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await vi.waitFor(() => expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1));
    act(() => {
      emitAppStateChange('background');
    });

    await act(async () => {
      captureRequest.resolve(capture.stream);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(startPromise).resolves.toBe(false);
    });

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(publishStream).not.toHaveBeenCalled();
    expect(unpublishStream).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('does not start capture after unmount during the permission prompt', async () => {
    Object.assign(Platform, { OS: 'android', Version: 33 });
    const permission = deferred<Awaited<ReturnType<typeof PermissionsAndroid.request>>>();
    vi.mocked(PermissionsAndroid.request).mockReturnValue(permission.promise);
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useScreenShare({ publishStream, unpublishStream })
    );

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1));
    unmount();

    permission.resolve(PermissionsAndroid.RESULTS.GRANTED);
    await act(async () => {
      await expect(startPromise).resolves.toBe(false);
    });
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('only reports active after capture publishing succeeds', async () => {
    const capture = createCapture();
    const publication = deferred<undefined>();
    const publishStream = vi.fn(() => publication.promise);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('publishing'));
    expect(result.current.isSharing).toBe(false);

    publication.resolve(undefined);
    await act(async () => {
      await expect(startPromise).resolves.toBe(true);
    });

    expect(result.current.state).toBe('active');
    expect(result.current.isSharing).toBe(true);
  });

  it('prevents duplicate capture requests', async () => {
    const captureRequest = deferred<MediaStream>();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockReturnValue(captureRequest.promise);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let firstStart!: Promise<boolean>;
    let secondStart!: Promise<boolean>;
    act(() => {
      firstStart = result.current.start();
      secondStart = result.current.start();
    });
    await expect(secondStart).resolves.toBe(false);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);

    captureRequest.resolve(createCapture().stream);
    await act(async () => {
      await expect(firstStart).resolves.toBe(true);
    });
  });

  it('rolls back capture when publishing fails', async () => {
    const capture = createCapture();
    const publishStream = vi.fn().mockRejectedValue(new Error('Viewer signaling failed'));
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(false);
    });

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(unpublishStream).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe(
      'Could not share your screen with viewers. Check your connection and try again.'
    );
    expect(result.current.error).not.toContain('Viewer signaling failed');
  });

  it('preserves a capture permission error before publishing starts', async () => {
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockRejectedValue(
      new Error('Screen capture permission denied')
    );

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    await act(async () => {
      await expect(result.current.start()).resolves.toBe(false);
    });

    expect(publishStream).not.toHaveBeenCalled();
    expect(unpublishStream).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('Screen capture permission denied');
  });

  it('discards a capture that resolves after stop', async () => {
    const capture = createCapture();
    const captureRequest = deferred<MediaStream>();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockReturnValue(captureRequest.promise);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.stop();
    });

    captureRequest.resolve(capture.stream);
    await act(async () => {
      await expect(startPromise).resolves.toBe(false);
    });

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(publishStream).not.toHaveBeenCalled();
    expect(unpublishStream).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');

    const nextCapture = createCapture();
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(nextCapture.stream);
    await act(async () => {
      await expect(result.current.start()).resolves.toBe(true);
    });
    expect(result.current.state).toBe('active');
  });

  it('waits for an in-flight publication before unpublishing', async () => {
    const capture = createCapture();
    const publication = deferred<undefined>();
    const publishStream = vi.fn(() => publication.promise);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));

    let startPromise!: Promise<boolean>;
    act(() => {
      startPromise = result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('publishing'));

    let stopPromise!: Promise<void>;
    act(() => {
      stopPromise = result.current.stop();
    });
    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(unpublishStream).not.toHaveBeenCalled();

    publication.resolve(undefined);
    await act(async () => {
      await Promise.all([startPromise, stopPromise]);
    });

    expect(unpublishStream).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
  });

  it('stops sharing when the native capture ends', async () => {
    const capture = createCapture();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      capture.end();
    });
    await waitFor(() => expect(result.current.state).toBe('idle'));

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(unpublishStream).toHaveBeenCalledTimes(1);
  });

  it('survives an inactive interruption but stops cleanly in the background', async () => {
    const capture = createCapture();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      emitAppStateChange('inactive');
    });
    expect(result.current.state).toBe('active');
    expect(capture.track.stop).not.toHaveBeenCalled();

    act(() => {
      emitAppStateChange('background');
    });
    await waitFor(() => expect(result.current.state).toBe('idle'));

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    expect(unpublishStream).toHaveBeenCalledTimes(1);
    expect(result.current.isSharing).toBe(false);
  });

  it('serializes duplicate stop requests', async () => {
    const capture = createCapture();
    const unpublication = deferred<undefined>();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn(() => unpublication.promise);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result } = renderHook(() => useScreenShare({ publishStream, unpublishStream }));
    await act(async () => {
      await result.current.start();
    });

    let firstStop!: Promise<void>;
    let secondStop!: Promise<void>;
    act(() => {
      firstStop = result.current.stop();
      secondStop = result.current.stop();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(unpublishStream).toHaveBeenCalledTimes(1);

    unpublication.resolve(undefined);
    await act(async () => {
      await Promise.all([firstStop, secondStop]);
    });
    expect(result.current.state).toBe('idle');
  });

  it('stops capture and unpublishes on unmount', async () => {
    const capture = createCapture();
    const publishStream = vi.fn().mockResolvedValue(undefined);
    const unpublishStream = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mediaDevices.getDisplayMedia).mockResolvedValue(capture.stream);

    const { result, unmount } = renderHook(() =>
      useScreenShare({ publishStream, unpublishStream })
    );
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(capture.track.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(unpublishStream).toHaveBeenCalledTimes(1));
  });
});
