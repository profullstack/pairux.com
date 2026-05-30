import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCamera } from './useCamera';

const trackStop = vi.fn();

class MockMediaStream {
  private tracks: { kind: string; stop: () => void; getSettings: () => { deviceId: string } }[];
  constructor() {
    this.tracks = [{ kind: 'video', stop: trackStop, getSettings: () => ({ deviceId: 'cam-1' }) }];
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}

const mockGetUserMedia = vi.fn();
const mockEnumerateDevices = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserMedia.mockResolvedValue(new MockMediaStream());
  mockEnumerateDevices.mockResolvedValue([
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam' },
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic' },
  ]);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia, enumerateDevices: mockEnumerateDevices },
    writable: true,
    configurable: true,
  });
});

describe('useCamera', () => {
  it('is off by default and captures nothing', () => {
    const { result } = renderHook(() => useCamera());
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.stream).toBeNull();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('enables the camera and lists video devices', async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.enable();
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.any(Object), audio: false })
    );
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.deviceId).toBe('cam-1');
    await waitFor(() => {
      expect(result.current.devices).toHaveLength(1);
    });
  });

  it('stops all tracks when disabled', async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.enable();
    });
    act(() => {
      result.current.disable();
    });

    expect(trackStop).toHaveBeenCalled();
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.stream).toBeNull();
  });

  it('surfaces an error when access is denied', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.error).toBe('Permission denied');
    expect(result.current.isEnabled).toBe(false);
  });

  it('toggles on and off', async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isEnabled).toBe(true);

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.isEnabled).toBe(false);
  });
});
