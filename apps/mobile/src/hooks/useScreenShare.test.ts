import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { useScreenShare } from './useScreenShare';

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
