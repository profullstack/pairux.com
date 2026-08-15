import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTC } from './useWebRTC';

// Mock Supabase client
const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((_callback: (status: string) => void) => {
    // Don't auto-subscribe in most tests
    return mockChannel;
  }),
  send: vi.fn().mockResolvedValue(undefined),
  track: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
  }),
}));

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: unknown }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null;

  constructor() {
    MockRTCPeerConnection.instances.push(this);
  }

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test-offer-sdp' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test-answer-sdp' });
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn().mockReturnValue({
    getParameters: () => ({ encodings: [{}] }),
    setParameters: vi.fn().mockResolvedValue(undefined),
  });
  getSenders = vi.fn().mockReturnValue([]);
  getStats = vi.fn().mockResolvedValue(new Map());
  close = vi.fn();
}

// Mock MediaStream and tracks for mic
function createMockAudioTrack() {
  return {
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
    id: 'mock-audio-track',
  };
}

function createMockMicStream() {
  const audioTrack = createMockAudioTrack();
  return {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
    getVideoTracks: () => [],
    _audioTrack: audioTrack,
  } as unknown as MediaStream & { _audioTrack: ReturnType<typeof createMockAudioTrack> };
}

describe('useWebRTC', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockRTCPeerConnection.instances = [];
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = vi.fn((c: unknown) => c);

    mockGetUserMedia = vi.fn();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      },
      writable: true,
      configurable: true,
    });

    // Reset channel mocks
    mockChannel.on.mockReturnThis();
    mockChannel.subscribe.mockImplementation(() => mockChannel);
    mockChannel.send.mockResolvedValue(undefined);
    mockChannel.track.mockResolvedValue(undefined);
    mockChannel.unsubscribe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    sessionId: 'session-1',
    participantId: 'viewer-1',
  };

  it('should initialize with default state including mic fields', () => {
    // Don't trigger full initialization
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    expect(result.current.connectionState).toBe('idle');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
    expect(result.current.toggleMic).toBeInstanceOf(Function);
  });

  it('should export all required microphone fields', () => {
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    // Verify all mic-related fields are exported
    expect('micEnabled' in result.current).toBe(true);
    expect('hasMic' in result.current).toBe(true);
    expect('toggleMic' in result.current).toBe(true);
  });

  it('should export all control-related fields', () => {
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    expect('controlState' in result.current).toBe(true);
    expect('dataChannelReady' in result.current).toBe(true);
    expect('requestControl' in result.current).toBe(true);
    expect('releaseControl' in result.current).toBe(true);
    expect('sendInput' in result.current).toBe(true);
  });

  describe('microphone capture', () => {
    it('should set hasMic=true and micEnabled=true on successful mic capture', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.hasMic).toBe(true);
      expect(hookResult!.current.micEnabled).toBe(true);
      // Echo cancellation must be requested explicitly — a bare `audio: true`
      // is what let the remote party's voice loop back through the mic.
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
        video: false,
      });
    });

    it('should set up channel subscription after getUserMedia resolves', async () => {
      const mockStream = createMockMicStream();
      const callOrder: string[] = [];

      mockGetUserMedia.mockImplementation(async () => {
        callOrder.push('getUserMedia');
        return mockStream;
      });

      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callOrder.push('subscribe');
        callback('SUBSCRIBED');
        return mockChannel;
      });

      await act(async () => {
        renderHook(() => useWebRTC(defaultOptions));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // getUserMedia should resolve BEFORE channel subscription is set up
      expect(callOrder.indexOf('getUserMedia')).toBeLessThan(callOrder.indexOf('subscribe'));
    });

    it('should gracefully handle mic permission denied', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the rejected promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.hasMic).toBe(false);
      expect(hookResult!.current.micEnabled).toBe(false);
      // Should not set an error for mic permission denial
      expect(hookResult!.current.error).toBeNull();
    });

    it('should still set up signaling channel when mic is denied', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

      await act(async () => {
        renderHook(() => useWebRTC(defaultOptions));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Channel should still be subscribed even after mic denial
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });
  });

  describe('toggleMic', () => {
    it('should toggle mic track enabled state', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.micEnabled).toBe(true);

      // Toggle off
      act(() => {
        hookResult!.current.toggleMic();
      });

      expect(hookResult!.current.micEnabled).toBe(false);
      expect(mockStream._audioTrack.enabled).toBe(false);

      // Toggle back on
      act(() => {
        hookResult!.current.toggleMic();
      });

      expect(hookResult!.current.micEnabled).toBe(true);
      expect(mockStream._audioTrack.enabled).toBe(true);
    });

    it('should be no-op when no mic stream exists', () => {
      mockGetUserMedia.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useWebRTC(defaultOptions));

      // Should not throw
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
    });
  });

  describe('ICE candidate buffering', () => {
    it('drains every buffered ICE candidate even when one is stale', async () => {
      mockGetUserMedia.mockResolvedValue(createMockMicStream());

      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      await act(async () => {
        renderHook(() => useWebRTC(defaultOptions));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Get the signal handler from channel.on calls
      const signalCall = mockChannel.on.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
      );
      expect(signalCall).toBeDefined();
      const signalHandler = signalCall![2] as (payload: { payload: unknown }) => void;

      const pc = MockRTCPeerConnection.instances[0]!;

      // Send two ICE candidates before any offer (no remote description).
      await act(async () => {
        for (const candidate of ['stale-candidate', 'valid-candidate']) {
          signalHandler({
            payload: {
              type: 'ice-candidate',
              candidate: { candidate },
              senderId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.addIceCandidate).not.toHaveBeenCalled();
      pc.addIceCandidate
        .mockRejectedValueOnce(new Error('stale ICE generation'))
        .mockResolvedValueOnce(undefined);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'host-offer',
            senderId: 'host-1',
            negotiationId: 'offer-1',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.addIceCandidate).toHaveBeenNthCalledWith(1, {
        candidate: 'stale-candidate',
      });
      expect(pc.addIceCandidate).toHaveBeenNthCalledWith(2, {
        candidate: 'valid-candidate',
      });
    });

    it('should process offer with signaling state rollback if not stable', async () => {
      mockGetUserMedia.mockResolvedValue(createMockMicStream());

      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      await act(async () => {
        renderHook(() => useWebRTC(defaultOptions));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const signalCall = mockChannel.on.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
      );
      const signalHandler = signalCall![2] as (payload: { payload: unknown }) => void;

      // Send an offer — should set remote description and create answer
      await act(async () => {
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'test-offer-sdp',
            senderId: 'host-1',
            negotiationId: 'negotiation-1',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Verify the offer was processed: setRemoteDescription + createAnswer + setLocalDescription
      const pc = MockRTCPeerConnection.instances[0]!;
      expect(pc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'offer', sdp: 'test-offer-sdp' })
      );
      expect(pc.createAnswer).toHaveBeenCalled();
      expect(pc.setLocalDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'answer', sdp: 'test-answer-sdp' })
      );
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'signal',
        payload: expect.objectContaining({
          type: 'answer',
          negotiationId: 'negotiation-1',
        }),
      });
    });
  });

  describe('signaling routing', () => {
    const initializeSubscribedViewer = async () => {
      mockGetUserMedia.mockResolvedValue(createMockMicStream());
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      await act(async () => {
        renderHook(() => useWebRTC(defaultOptions));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const signalCall = mockChannel.on.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
      );
      expect(signalCall).toBeDefined();

      return {
        pc: MockRTCPeerConnection.instances[0]!,
        signalHandler: signalCall![2] as (payload: { payload: unknown }) => void,
      };
    };

    it('ignores messages for another viewer and untargeted messages from a non-host peer', async () => {
      const { pc, signalHandler } = await initializeSubscribedViewer();

      await act(async () => {
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'other-viewer-offer',
            senderId: 'host-1',
            targetId: 'viewer-2',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.setRemoteDescription).not.toHaveBeenCalled();

      await act(async () => {
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'host-offer',
            senderId: 'host-1',
            targetId: 'viewer-1',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'viewer-restart-offer',
            senderId: 'viewer-2',
            timestamp: Date.now(),
          },
        });
        signalHandler({
          payload: {
            type: 'ice-candidate',
            candidate: { candidate: 'viewer-candidate' },
            senderId: 'viewer-2',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
      expect(pc.addIceCandidate).not.toHaveBeenCalled();
    });

    it('targets its answer, ICE candidates, and ICE-restart offer to the accepted host', async () => {
      const { pc, signalHandler } = await initializeSubscribedViewer();

      await act(async () => {
        // Untargeted first offers remain supported for older hosts.
        signalHandler({
          payload: {
            type: 'offer',
            sdp: 'legacy-host-offer',
            senderId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'signal',
        payload: expect.objectContaining({
          type: 'answer',
          senderId: 'viewer-1',
          targetId: 'host-1',
        }),
      });

      mockChannel.send.mockClear();
      act(() => {
        pc.onicecandidate?.({
          candidate: {
            toJSON: () => ({ candidate: 'viewer-candidate' }),
          },
        });
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'signal',
        payload: expect.objectContaining({
          type: 'ice-candidate',
          senderId: 'viewer-1',
          targetId: 'host-1',
        }),
      });

      mockChannel.send.mockClear();
      pc.iceConnectionState = 'failed';
      await act(async () => {
        pc.oniceconnectionstatechange?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'signal',
        payload: expect.objectContaining({
          type: 'offer',
          senderId: 'viewer-1',
          targetId: 'host-1',
        }),
      });
    });

    it('accepts late ICE from an earlier offer on the same peer connection', async () => {
      const { pc, signalHandler } = await initializeSubscribedViewer();

      await act(async () => {
        for (const [sdp, negotiationId] of [
          ['initial-offer', 'offer-1'],
          ['relay-offer', 'offer-2'],
        ]) {
          signalHandler({
            payload: {
              type: 'offer',
              sdp,
              senderId: 'host-1',
              targetId: 'viewer-1',
              negotiationId,
              timestamp: Date.now(),
            },
          });
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }

        signalHandler({
          payload: {
            type: 'ice-candidate',
            candidate: { candidate: 'late-initial-candidate' },
            senderId: 'host-1',
            targetId: 'viewer-1',
            negotiationId: 'offer-1',
            timestamp: Date.now(),
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.addIceCandidate).toHaveBeenCalledWith({
        candidate: 'late-initial-candidate',
      });
    });
  });

  describe('remote participant audio', () => {
    const createRemoteAudioTrack = (id: string) => {
      let endedListener: (() => void) | null = null;
      const track = {
        id,
        kind: 'audio',
        readyState: 'live',
        addEventListener: vi.fn((type: string, listener: () => void) => {
          if (type === 'ended') endedListener = listener;
        }),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack;

      return {
        track,
        end: () => endedListener?.(),
      };
    };

    it('retains simultaneous host and relayed participant audio tracks', async () => {
      mockGetUserMedia.mockResolvedValue(createMockMicStream());
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      let hookResult: { current: ReturnType<typeof useWebRTC> };
      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const pc = MockRTCPeerConnection.instances[0]!;
      const hostAudio = createRemoteAudioTrack('host-audio');
      const participantAudio = createRemoteAudioTrack('participant-2-audio');
      const hostStream = new MediaStream([hostAudio.track]);
      const participantStream = new MediaStream([participantAudio.track]);

      act(() => {
        pc.ontrack?.({
          streams: [hostStream],
          track: hostAudio.track,
        });
        pc.ontrack?.({
          streams: [participantStream],
          track: participantAudio.track,
        });
      });

      expect(hookResult!.current.remoteStream?.getAudioTracks().map((track) => track.id)).toEqual([
        'host-audio',
        'participant-2-audio',
      ]);

      act(() => {
        // Negotiated sender removal fires removetrack while the receiver track
        // can remain live/muted; it does not reliably fire ended.
        participantStream.removeTrack(participantAudio.track);
      });

      expect(hookResult!.current.remoteStream?.getAudioTracks().map((track) => track.id)).toEqual([
        'host-audio',
      ]);

      act(() => {
        hostAudio.end();
      });
      expect(hookResult!.current.remoteStream).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('should reset mic state on disconnect', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.micEnabled).toBe(true);

      act(() => {
        hookResult!.current.disconnect();
      });

      expect(hookResult!.current.micEnabled).toBe(false);
      expect(hookResult!.current.hasMic).toBe(false);
      expect(hookResult!.current.connectionState).toBe('disconnected');
      // Mic tracks should be stopped
      expect(mockStream._audioTrack.stop).toHaveBeenCalled();
    });
  });
});
