import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCHost } from './useWebRTCHost';

const mockAmplifyRemoteAudio = vi.hoisted(() => vi.fn());

// Mock Supabase client
const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
  send: vi.fn().mockResolvedValue(undefined),
  track: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
  }),
}));

vi.mock('@/lib/remoteAudioGain', () => ({
  amplifyRemoteAudio: mockAmplifyRemoteAudio,
}));

// Mock RTCPeerConnection
class MockRTCRtpSender {
  track: MediaStreamTrack | null;
  getParameters = vi.fn(() => ({ encodings: [{}] }));
  setParameters = vi.fn().mockResolvedValue(undefined);
  replaceTrack = vi.fn(async (track: MediaStreamTrack | null) => {
    this.track = track;
  });

  constructor(track: MediaStreamTrack) {
    this.track = track;
  }
}

class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  private readonly senders: MockRTCRtpSender[] = [];
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test-sdp' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test-answer-sdp' });
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    }
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
    if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn((track: MediaStreamTrack) => {
    const sender = new MockRTCRtpSender(track);
    this.senders.push(sender);
    return sender;
  });
  removeTrack = vi.fn((sender: MockRTCRtpSender) => {
    sender.track = null;
  });
  getSenders = vi.fn(() => this.senders);
  getStats = vi.fn().mockResolvedValue(new Map());
  createDataChannel = vi.fn().mockReturnValue({
    onopen: null,
    onclose: null,
    onmessage: null,
    readyState: 'connecting',
    send: vi.fn(),
  });
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });

  constructor() {
    MockRTCPeerConnection.instances.push(this);
  }
}

// Create mock MediaStream
function createMockStream(): MediaStream {
  const mockTrack = {
    kind: 'video',
    contentHint: '',
    getSettings: () => ({ width: 1920, height: 1080 }),
  };
  return {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

// Create mock mic stream with controllable audio tracks
interface MockMicTrack {
  kind: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}

type MockMicStream = MediaStream & { _audioTracks: MockMicTrack[] };

function createMockMicStream(): MockMicStream {
  const micTrack: MockMicTrack = {
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
  };
  return {
    _audioTracks: [micTrack],
    getTracks: () => [micTrack],
    getVideoTracks: () => [],
    getAudioTracks: () => [micTrack],
  } as unknown as MockMicStream;
}

async function flushAsyncWork(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve();
  }
}

describe('useWebRTCHost', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockRTCPeerConnection.instances = [];
    mockAmplifyRemoteAudio.mockImplementation((track: MediaStreamTrack) => ({
      stream: {
        getTracks: () => [track],
        getAudioTracks: () => [track],
        getVideoTracks: () => [],
      },
      setGain: vi.fn(),
      dispose: vi.fn(),
    }));
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = vi.fn((c: unknown) => c);
    (globalThis as Record<string, unknown>).MediaStream = vi.fn((tracks?: MediaStreamTrack[]) => ({
      getTracks: () => tracks ?? [],
      getVideoTracks: () => [],
      getAudioTracks: () => tracks?.filter((t) => t.kind === 'audio') ?? [],
    }));
    (globalThis as Record<string, unknown>).Audio = vi.fn(() => ({
      srcObject: null,
      autoplay: false,
      volume: 1.0,
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    }));

    // Mock navigator.mediaDevices.getUserMedia for mic capture
    mockGetUserMedia = vi.fn().mockResolvedValue(createMockMicStream());
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
    mockChannel.subscribe.mockReturnThis();
    mockChannel.send.mockResolvedValue(undefined);
    mockChannel.track.mockResolvedValue(undefined);
    mockChannel.unsubscribe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    sessionId: 'session-1',
    hostId: 'host-1',
    localStream: createMockStream(),
  };

  const initializeSubscribedHost = async () => {
    mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
      callback('SUBSCRIBED');
      return mockChannel;
    });

    const hook = renderHook(() => useWebRTCHost(defaultOptions));
    await act(async () => {
      await hook.result.current.startHosting();
      await flushAsyncWork();
    });

    const signalCall = mockChannel.on.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
    );
    const joinCall = mockChannel.on.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'presence' && (call[1] as Record<string, string>).event === 'join'
    );
    const leaveCall = mockChannel.on.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'presence' && (call[1] as Record<string, string>).event === 'leave'
    );

    expect(signalCall).toBeDefined();
    expect(joinCall).toBeDefined();
    expect(leaveCall).toBeDefined();

    const rawSignalHandler = signalCall![2] as (payload: { payload: unknown }) => void;
    const signalHandler = (event: { payload: unknown }) => {
      const message = event.payload as {
        type?: string;
        senderId?: string;
        negotiationId?: string;
      };
      if (message.type === 'answer' && message.senderId && !message.negotiationId) {
        const offerCall = [...mockChannel.send.mock.calls].reverse().find(([request]) => {
          const payload = (request as { payload?: { type?: string; targetId?: string } }).payload;
          return payload?.type === 'offer' && payload.targetId === message.senderId;
        });
        const negotiationId = (
          offerCall?.[0] as { payload?: { negotiationId?: string } } | undefined
        )?.payload?.negotiationId;
        if (negotiationId) {
          rawSignalHandler({
            payload: { ...(event.payload as object), negotiationId },
          });
          return;
        }
      }
      rawSignalHandler(event);
    };

    return {
      ...hook,
      signalHandler,
      rawSignalHandler,
      joinHandler: joinCall![2] as (payload: {
        newPresences: { user_id: string; role: string }[];
      }) => void,
      leaveHandler: leaveCall![2] as (payload: {
        leftPresences: { user_id: string; role: string }[];
      }) => void,
    };
  };

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useWebRTCHost(defaultOptions));

    expect(result.current.isHosting).toBe(false);
    expect(result.current.viewerCount).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.controllingViewer).toBeNull();
  });

  it('should expose muteViewer in returned API', () => {
    const { result } = renderHook(() => useWebRTCHost(defaultOptions));
    expect(result.current.muteViewer).toBeInstanceOf(Function);
  });

  it('should start hosting without a stream (voice-only session)', () => {
    const { result } = renderHook(() => useWebRTCHost({ ...defaultOptions, localStream: null }));

    act(() => {
      void result.current.startHosting();
    });

    // Should not set an error — voice-only sessions are now supported
    expect(result.current.error).toBeNull();
  });

  describe('startHosting', () => {
    it('should set isHosting when channel subscribes', async () => {
      // Mock subscribe to call callback with 'SUBSCRIBED'
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.isHosting).toBe(true);
      expect(result.current.error).toBeNull();
    });
  });

  describe('stopHosting', () => {
    it('should clean up audio elements when stopping', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      act(() => {
        result.current.stopHosting();
      });

      expect(result.current.isHosting).toBe(false);
      expect(result.current.viewerCount).toBe(0);
    });
  });

  describe('muteViewer', () => {
    it('should handle muteViewer call for nonexistent viewer gracefully', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Should not throw
      act(() => {
        result.current.muteViewer('nonexistent-viewer', true);
      });
    });
  });

  describe('ViewerConnection audio fields', () => {
    it('should export viewers map with audio-related fields', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Viewers is a Map
      expect(result.current.viewers).toBeInstanceOf(Map);
      expect(result.current.viewers.size).toBe(0);
    });
  });

  describe('host microphone', () => {
    it('should initialize mic state as disabled', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      expect(result.current.micEnabled).toBe(false);
      expect(result.current.hasMic).toBe(false);
      expect(result.current.micStream).toBeNull();
      expect(result.current.toggleMic).toBeInstanceOf(Function);
    });

    it('should capture mic when startHosting is called', async () => {
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

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
      expect(result.current.hasMic).toBe(true);
      expect(result.current.micEnabled).toBe(true);
    });

    it('should host without mic when getUserMedia fails', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      // Should still be hosting despite mic failure
      expect(result.current.isHosting).toBe(true);
      expect(result.current.hasMic).toBe(false);
      expect(result.current.micEnabled).toBe(false);
      expect(result.current.micStream).toBeNull();
    });

    it('should toggle mic audio track enabled state', async () => {
      const mockMicStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockMicStream);
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.micEnabled).toBe(true);

      // Toggle mic off
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
      expect(mockMicStream._audioTracks[0]!.enabled).toBe(false);

      // Toggle mic back on
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(true);
      expect(mockMicStream._audioTracks[0]!.enabled).toBe(true);
    });

    it('should do nothing when toggleMic is called without a mic', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Should not throw when no mic is available
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
    });

    it('should stop mic tracks when stopHosting is called', async () => {
      const mockMicStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockMicStream);
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.hasMic).toBe(true);

      act(() => {
        result.current.stopHosting();
      });

      // Mic tracks should have been stopped
      expect(mockMicStream._audioTracks[0]!.stop).toHaveBeenCalled();
    });
  });

  describe('ICE candidate buffering', () => {
    it('should export pendingCandidatesRef functionality (no crash on early ICE)', async () => {
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.isHosting).toBe(true);

      // Simulate a viewer signal with ICE candidate before answer
      // Get the signal handler from channel.on calls
      const signalCall = mockChannel.on.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
      );

      // If the channel was set up, verify the hook handles early ICE candidates
      if (signalCall) {
        const signalHandler = signalCall[2] as (payload: { payload: unknown }) => void;

        // Send ICE candidate for a non-existent viewer — should not crash
        await act(async () => {
          signalHandler({
            payload: {
              type: 'ice-candidate',
              candidate: { candidate: 'early-candidate' },
              senderId: 'unknown-viewer',
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
          await Promise.resolve();
        });

        expect(result.current.error).toBeNull();
      }
    });
  });

  describe('per-viewer renegotiation', () => {
    it('waits for the initial answer before offering a relayed audio track', async () => {
      const { joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      expect(targetPc.createOffer).toHaveBeenCalledTimes(1);
      expect(targetPc.signalingState).toBe('have-local-offer');

      const sourceAudioTrack = {
        id: 'viewer-1-audio',
        kind: 'audio',
      } as MediaStreamTrack;
      await act(async () => {
        sourcePc.ontrack?.({ track: sourceAudioTrack, streams: [] });
        await flushAsyncWork();
      });

      // Adding the relay marks viewer-2 dirty, but must not replace its
      // still-unanswered initial offer.
      expect(targetPc.addTrack).toHaveBeenCalledWith(sourceAudioTrack, expect.anything());
      expect(targetPc.createOffer).toHaveBeenCalledTimes(1);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-initial-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      expect(targetPc.createOffer).toHaveBeenCalledTimes(2);
      expect(targetPc.signalingState).toBe('have-local-offer');

      const offersToViewer2 = mockChannel.send.mock.calls.filter(([request]) => {
        const payload = (request as { payload?: { type?: string; targetId?: string } }).payload;
        return payload?.type === 'offer' && payload.targetId === 'viewer-2';
      });
      expect(offersToViewer2).toHaveLength(2);
    });

    it('coalesces simultaneous relay changes into one follow-up offer per viewer', async () => {
      const { joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
            { user_id: 'viewer-3', role: 'viewer' },
          ],
        });
        await flushAsyncWork();

        for (const viewerId of ['viewer-1', 'viewer-2', 'viewer-3']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const firstSourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const secondSourcePc = MockRTCPeerConnection.instances[2]!;
      expect(targetPc.signalingState).toBe('stable');

      await act(async () => {
        firstSourcePc.ontrack?.({
          track: { id: 'viewer-1-audio', kind: 'audio' } as MediaStreamTrack,
          streams: [],
        });
        await flushAsyncWork();
      });
      expect(targetPc.createOffer).toHaveBeenCalledTimes(2);
      expect(targetPc.signalingState).toBe('have-local-offer');

      await act(async () => {
        secondSourcePc.ontrack?.({
          track: { id: 'viewer-3-audio', kind: 'audio' } as MediaStreamTrack,
          streams: [],
        });
        await flushAsyncWork();
      });

      // The second track change is remembered, but no second offer is created
      // while viewer-2's first relay offer is outstanding.
      expect(targetPc.createOffer).toHaveBeenCalledTimes(2);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-first-relay-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      expect(targetPc.createOffer).toHaveBeenCalledTimes(3);
    });

    it('does not let a stale answer consume ICE for a same-ID rejoin', async () => {
      const { joinHandler, leaveHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
      });

      const oldOffer = [...mockChannel.send.mock.calls]
        .reverse()
        .map(
          ([request]) =>
            (request as { payload?: { type?: string; targetId?: string; negotiationId?: string } })
              .payload
        )
        .find((payload) => payload?.type === 'offer' && payload.targetId === 'viewer-1')!;

      await act(async () => {
        leaveHandler({
          leftPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
      });
      const newPc = MockRTCPeerConnection.instances[1]!;
      const newOffer = [...mockChannel.send.mock.calls]
        .reverse()
        .map(
          ([request]) =>
            (request as { payload?: { type?: string; targetId?: string; negotiationId?: string } })
              .payload
        )
        .find((payload) => payload?.type === 'offer' && payload.targetId === 'viewer-1')!;
      expect(newOffer.negotiationId).not.toBe(oldOffer.negotiationId);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'stale-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            negotiationId: oldOffer.negotiationId,
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });
      expect(newPc.setRemoteDescription).not.toHaveBeenCalled();

      act(() => {
        signalHandler({
          payload: {
            type: 'ice-candidate',
            candidate: { candidate: 'new-generation-candidate' },
            senderId: 'viewer-1',
            targetId: 'host-1',
            negotiationId: newOffer.negotiationId,
            timestamp: Date.now(),
          },
        });
      });
      await act(async () => {
        await flushAsyncWork();
      });

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'new-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            negotiationId: newOffer.negotiationId,
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      expect(newPc.addIceCandidate).toHaveBeenCalledWith({
        candidate: 'new-generation-candidate',
      });
    });

    it('keeps legacy answers and candidates compatible across reconnects', async () => {
      const { joinHandler, leaveHandler, rawSignalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({ newPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        await flushAsyncWork();
        rawSignalHandler({
          payload: {
            type: 'answer',
            sdp: 'legacy-first-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });
      expect(MockRTCPeerConnection.instances[0]!.setRemoteDescription).toHaveBeenCalledTimes(1);

      await act(async () => {
        leaveHandler({ leftPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        joinHandler({ newPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        await flushAsyncWork();
        rawSignalHandler({
          payload: {
            type: 'ice-candidate',
            candidate: { candidate: 'legacy-reconnect-candidate' },
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        rawSignalHandler({
          payload: {
            type: 'answer',
            sdp: 'legacy-reconnect-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });
      expect(MockRTCPeerConnection.instances[1]!.setRemoteDescription).toHaveBeenCalledTimes(1);
      expect(MockRTCPeerConnection.instances[1]!.addIceCandidate).toHaveBeenCalledWith({
        candidate: 'legacy-reconnect-candidate',
      });
    });

    it('accepts late ICE from a prior offer on the current peer connection', async () => {
      const { joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const initialOffer = mockChannel.send.mock.calls
        .map(
          ([request]) =>
            (request as { payload?: { type?: string; targetId?: string; negotiationId?: string } })
              .payload
        )
        .find((payload) => payload?.type === 'offer' && payload.targetId === 'viewer-2')!;

      await act(async () => {
        sourcePc.ontrack?.({
          track: { id: 'viewer-1-audio', kind: 'audio' } as MediaStreamTrack,
          streams: [],
        });
        await flushAsyncWork();
      });

      const relayOffer = [...mockChannel.send.mock.calls]
        .reverse()
        .map(
          ([request]) =>
            (request as { payload?: { type?: string; targetId?: string; negotiationId?: string } })
              .payload
        )
        .find((payload) => payload?.type === 'offer' && payload.targetId === 'viewer-2')!;
      expect(relayOffer.negotiationId).not.toBe(initialOffer.negotiationId);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'ice-candidate',
            candidate: { candidate: 'late-initial-candidate' },
            senderId: 'viewer-2',
            targetId: 'host-1',
            negotiationId: initialOffer.negotiationId,
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      expect(targetPc.addIceCandidate).toHaveBeenCalledWith({
        candidate: 'late-initial-candidate',
      });
    });
  });

  describe('audio relay lifecycle', () => {
    it('still relays audio and retries playback when local amplification fails', async () => {
      const { result, joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const sourceTrack = {
        id: 'viewer-1-audio',
        kind: 'audio',
        enabled: true,
      } as MediaStreamTrack;
      mockAmplifyRemoteAudio.mockImplementationOnce(() => {
        throw new Error('audio context unavailable');
      });

      await act(async () => {
        sourcePc.ontrack?.({ track: sourceTrack, streams: [] });
        await flushAsyncWork();
      });

      expect(targetPc.addTrack).toHaveBeenCalledWith(sourceTrack, expect.anything());
      expect(result.current.viewers.get('viewer-1')?.audioTrack).toBe(sourceTrack);
      expect(result.current.viewers.get('viewer-1')?.audioElement).toBeNull();

      await act(async () => {
        sourcePc.ontrack?.({ track: sourceTrack, streams: [] });
        await flushAsyncWork();
      });

      expect(mockAmplifyRemoteAudio).toHaveBeenCalledTimes(2);
      expect(result.current.viewers.get('viewer-1')?.audioElement).not.toBeNull();
      expect(targetPc.addTrack.mock.calls.filter(([track]) => track === sourceTrack)).toHaveLength(
        1
      );
    });

    it('keeps repeated ontrack idempotent and replaces playback and relay ownership', async () => {
      const { joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const firstTrack = { id: 'viewer-1-audio-a', kind: 'audio' } as MediaStreamTrack;

      await act(async () => {
        sourcePc.ontrack?.({ track: firstTrack, streams: [] });
        await flushAsyncWork();
        sourcePc.ontrack?.({ track: firstTrack, streams: [] });
        await flushAsyncWork();
      });

      expect(mockAmplifyRemoteAudio).toHaveBeenCalledTimes(1);
      const firstTrackRelayCalls = targetPc.addTrack.mock.calls.filter(
        ([track]) => track === firstTrack
      );
      expect(firstTrackRelayCalls).toHaveLength(1);

      const relayCallIndex = targetPc.addTrack.mock.calls.findIndex(
        ([track]) => track === firstTrack
      );
      const relaySender = targetPc.addTrack.mock.results[relayCallIndex]!.value;
      const firstAmplified = mockAmplifyRemoteAudio.mock.results[0]!.value as {
        dispose: ReturnType<typeof vi.fn>;
      };
      const firstAudioElement = (
        globalThis.Audio as unknown as {
          mock: { results: { value: { pause: ReturnType<typeof vi.fn>; srcObject: unknown } }[] };
        }
      ).mock.results[0]!.value;

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-first-relay-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const replacementTrack = {
        id: 'viewer-1-audio-b',
        kind: 'audio',
      } as MediaStreamTrack;
      await act(async () => {
        sourcePc.ontrack?.({ track: replacementTrack, streams: [] });
        await flushAsyncWork();
      });

      expect(firstAmplified.dispose).toHaveBeenCalledTimes(1);
      expect(firstAudioElement.pause).toHaveBeenCalledTimes(1);
      expect(firstAudioElement.srcObject).toBeNull();
      expect(targetPc.removeTrack).toHaveBeenCalledWith(relaySender);
      expect(relaySender.replaceTrack).not.toHaveBeenCalled();
      expect(
        targetPc.addTrack.mock.calls.filter(([track]) => track === replacementTrack)
      ).toHaveLength(1);
      expect(targetPc.createOffer).toHaveBeenCalledTimes(3);
    });

    it('removes a departing source relay once and adds one fresh sender after rejoin', async () => {
      const { joinHandler, leaveHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const firstSourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const firstTrack = { id: 'viewer-1-audio-a', kind: 'audio' } as MediaStreamTrack;
      await act(async () => {
        firstSourcePc.ontrack?.({ track: firstTrack, streams: [] });
        await flushAsyncWork();
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-first-relay-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const firstRelayCallIndex = targetPc.addTrack.mock.calls.findIndex(
        ([track]) => track === firstTrack
      );
      const firstRelaySender = targetPc.addTrack.mock.results[firstRelayCallIndex]!.value;
      expect(targetPc.createOffer).toHaveBeenCalledTimes(2);

      await act(async () => {
        leaveHandler({
          leftPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
      });

      expect(targetPc.removeTrack).toHaveBeenCalledTimes(1);
      expect(targetPc.removeTrack).toHaveBeenCalledWith(firstRelaySender);
      expect(targetPc.createOffer).toHaveBeenCalledTimes(3);

      await act(async () => {
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-relay-removal-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-1-rejoin-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const rejoinedSourcePc = MockRTCPeerConnection.instances[2]!;
      const rejoinedTrack = { id: 'viewer-1-audio-b', kind: 'audio' } as MediaStreamTrack;
      await act(async () => {
        rejoinedSourcePc.ontrack?.({ track: rejoinedTrack, streams: [] });
        await flushAsyncWork();
      });

      expect(targetPc.addTrack.mock.calls.filter(([track]) => track === firstTrack)).toHaveLength(
        1
      );
      expect(
        targetPc.addTrack.mock.calls.filter(([track]) => track === rejoinedTrack)
      ).toHaveLength(1);
      expect(firstRelaySender.replaceTrack).not.toHaveBeenCalled();
      expect(targetPc.createOffer).toHaveBeenCalledTimes(4);
    });

    it('ignores callbacks from an old connection after the same viewer ID rejoins', async () => {
      const { result, joinHandler, leaveHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
      });

      const oldPc = MockRTCPeerConnection.instances[0]!;
      const oldDataChannel = oldPc.createDataChannel.mock.results[0]!.value as {
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        onmessage: ((event: MessageEvent<string>) => void) | null;
      };

      await act(async () => {
        leaveHandler({
          leftPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
      });

      const newPc = MockRTCPeerConnection.instances[1]!;
      const signalCount = mockChannel.send.mock.calls.length;
      act(() => {
        oldPc.ontrack?.({
          track: { id: 'stale-audio', kind: 'audio', enabled: true } as MediaStreamTrack,
          streams: [],
        });
        oldPc.onconnectionstatechange?.();
        oldPc.onicecandidate?.({
          candidate: { toJSON: () => ({ candidate: 'stale-candidate' }) },
        });
        oldDataChannel.onopen?.();
        oldDataChannel.onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'control-request', timestamp: Date.now() }),
          })
        );
        oldDataChannel.onclose?.();
      });

      expect(result.current.viewerCount).toBe(1);
      expect(result.current.viewers.get('viewer-1')?.peerConnection).toBe(newPc);
      expect(result.current.viewers.get('viewer-1')?.audioTrack).toBeNull();
      expect(result.current.viewers.get('viewer-1')?.dataChannel).toBeNull();
      expect(mockChannel.send).toHaveBeenCalledTimes(signalCount);
    });

    it('keeps host mic and relay senders separate from published screen audio', async () => {
      const { result, joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const targetPc = MockRTCPeerConnection.instances[1]!;
      const relayTrack = {
        id: 'viewer-1-audio',
        kind: 'audio',
        enabled: true,
      } as MediaStreamTrack;
      await act(async () => {
        sourcePc.ontrack?.({ track: relayTrack, streams: [] });
        await flushAsyncWork();
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-2-relay-answer',
            senderId: 'viewer-2',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const originalScreenTrack = defaultOptions.localStream.getVideoTracks()[0]!;
      const originalScreenSender = targetPc
        .getSenders()
        .find((sender) => sender.track === originalScreenTrack)!;
      const relaySender = targetPc.getSenders().find((sender) => sender.track === relayTrack)!;
      const hostMicSender = targetPc
        .getSenders()
        .find((sender) => sender.track?.kind === 'audio' && sender !== relaySender)!;
      const hostMicTrack = hostMicSender.track;
      const screenVideo = {
        id: 'screen-video-2',
        kind: 'video',
        contentHint: '',
      } as MediaStreamTrack;
      const screenAudio = {
        id: 'screen-audio-2',
        kind: 'audio',
      } as MediaStreamTrack;
      const nextScreenStream = {
        getTracks: () => [screenVideo, screenAudio],
        getVideoTracks: () => [screenVideo],
        getAudioTracks: () => [screenAudio],
      } as unknown as MediaStream;

      await act(async () => {
        await result.current.publishStream(nextScreenStream);
        await flushAsyncWork();
      });

      expect(targetPc.removeTrack).toHaveBeenCalledWith(originalScreenSender);
      expect(targetPc.removeTrack).not.toHaveBeenCalledWith(relaySender);
      expect(targetPc.removeTrack).not.toHaveBeenCalledWith(hostMicSender);
      expect(relaySender.track).toBe(relayTrack);
      expect(hostMicSender.track).toBe(hostMicTrack);
      expect(targetPc.addTrack.mock.calls.filter(([track]) => track === screenAudio)).toHaveLength(
        1
      );
      expect(targetPc.addTrack.mock.calls.filter(([track]) => track === screenVideo)).toHaveLength(
        1
      );
    });

    it('does not publish a stale screen stream to later viewers after unpublish', async () => {
      const { result, joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [
            { user_id: 'viewer-1', role: 'viewer' },
            { user_id: 'viewer-2', role: 'viewer' },
          ],
        });
        await flushAsyncWork();
        for (const viewerId of ['viewer-1', 'viewer-2']) {
          signalHandler({
            payload: {
              type: 'answer',
              sdp: `${viewerId}-initial-answer`,
              senderId: viewerId,
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
        }
        await flushAsyncWork();
      });

      const firstPc = MockRTCPeerConnection.instances[0]!;
      const secondPc = MockRTCPeerConnection.instances[1]!;
      let releaseOffer!: () => void;
      const offerGate = new Promise<void>((resolve) => {
        releaseOffer = resolve;
      });
      firstPc.createOffer.mockImplementationOnce(async () => {
        await offerGate;
        return { type: 'offer', sdp: 'delayed-screen-offer' };
      });
      const staleVideo = {
        id: 'stale-screen-video',
        kind: 'video',
        contentHint: '',
      } as MediaStreamTrack;
      const staleAudio = {
        id: 'stale-screen-audio',
        kind: 'audio',
      } as MediaStreamTrack;
      const staleStream = {
        getTracks: () => [staleVideo, staleAudio],
        getVideoTracks: () => [staleVideo],
        getAudioTracks: () => [staleAudio],
      } as unknown as MediaStream;

      let publishPromise!: Promise<void>;
      act(() => {
        publishPromise = result.current.publishStream(staleStream);
      });
      await act(async () => {
        await Promise.resolve();
        await result.current.unpublishStream();
        releaseOffer();
        await publishPromise;
        await flushAsyncWork();
      });

      expect(firstPc.addTrack.mock.calls.filter(([track]) => track === staleVideo)).toHaveLength(1);
      expect(firstPc.addTrack.mock.calls.filter(([track]) => track === staleAudio)).toHaveLength(1);
      expect(secondPc.addTrack.mock.calls.filter(([track]) => track === staleVideo)).toHaveLength(
        0
      );
      expect(secondPc.addTrack.mock.calls.filter(([track]) => track === staleAudio)).toHaveLength(
        0
      );
      expect(firstPc.getSenders().some((sender) => sender.track === staleVideo)).toBe(false);
      expect(firstPc.getSenders().some((sender) => sender.track === staleAudio)).toBe(false);
    });

    it('includes an existing muted source in a new viewer initial offer', async () => {
      const { result, joinHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({
          newPresences: [{ user_id: 'viewer-1', role: 'viewer' }],
        });
        await flushAsyncWork();
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-1-initial-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const sourcePc = MockRTCPeerConnection.instances[0]!;
      const sourceTrack = {
        id: 'viewer-1-audio',
        kind: 'audio',
        enabled: true,
      } as MediaStreamTrack;
      const sourceDataChannel = sourcePc.createDataChannel.mock.results[0]!.value as {
        readyState: string;
        onopen: (() => void) | null;
        send: ReturnType<typeof vi.fn>;
      };
      await act(async () => {
        sourcePc.ontrack?.({ track: sourceTrack, streams: [] });
        await flushAsyncWork();
        result.current.muteViewer('viewer-1', true);
      });
      expect(result.current.viewers.get('viewer-1')?.isMuted).toBe(true);
      expect(sourceTrack.enabled).toBe(false);
      expect(sourceDataChannel.send).not.toHaveBeenCalled();

      await act(async () => {
        joinHandler({
          newPresences: [{ user_id: 'viewer-2', role: 'viewer' }],
        });
        await flushAsyncWork();
      });

      const newViewerPc = MockRTCPeerConnection.instances[1]!;
      expect(newViewerPc.addTrack).toHaveBeenCalledWith(sourceTrack, expect.anything());
      expect(newViewerPc.getSenders().some((sender) => sender.track === sourceTrack)).toBe(true);
      expect(sourceTrack.enabled).toBe(false);

      act(() => {
        sourceDataChannel.readyState = 'open';
        sourceDataChannel.onopen?.();
      });
      expect(JSON.parse(sourceDataChannel.send.mock.calls[0]![0] as string)).toMatchObject({
        type: 'mute',
        participantId: 'viewer-1',
        muted: true,
      });

      act(() => {
        result.current.muteViewer('viewer-1', false);
      });
      expect(sourceTrack.enabled).toBe(true);
      expect(JSON.parse(sourceDataChannel.send.mock.calls[1]![0] as string)).toMatchObject({
        type: 'mute',
        participantId: 'viewer-1',
        muted: false,
      });
      expect(sourcePc.createOffer).toHaveBeenCalledTimes(1);
      expect(newViewerPc.createOffer).toHaveBeenCalledTimes(1);
    });

    it('preserves host mute policy when the same viewer ID reconnects', async () => {
      const { result, joinHandler, leaveHandler, signalHandler } = await initializeSubscribedHost();

      await act(async () => {
        joinHandler({ newPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        await flushAsyncWork();
        signalHandler({
          payload: {
            type: 'answer',
            sdp: 'viewer-1-initial-answer',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          },
        });
        await flushAsyncWork();
      });

      const oldPc = MockRTCPeerConnection.instances[0]!;
      const oldTrack = {
        id: 'viewer-1-old-audio',
        kind: 'audio',
        enabled: true,
      } as MediaStreamTrack;
      act(() => {
        oldPc.ontrack?.({ track: oldTrack, streams: [] });
        result.current.muteViewer('viewer-1', true);
      });
      expect(oldTrack.enabled).toBe(false);

      await act(async () => {
        leaveHandler({ leftPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        joinHandler({ newPresences: [{ user_id: 'viewer-1', role: 'viewer' }] });
        await flushAsyncWork();
      });

      const newPc = MockRTCPeerConnection.instances[1]!;
      const newTrack = {
        id: 'viewer-1-new-audio',
        kind: 'audio',
        enabled: true,
      } as MediaStreamTrack;
      const newDataChannel = newPc.createDataChannel.mock.results[0]!.value as {
        readyState: string;
        onopen: (() => void) | null;
        send: ReturnType<typeof vi.fn>;
      };
      act(() => {
        newPc.ontrack?.({ track: newTrack, streams: [] });
      });

      expect(result.current.viewers.get('viewer-1')?.isMuted).toBe(true);
      expect(newTrack.enabled).toBe(false);

      act(() => {
        newDataChannel.readyState = 'open';
        newDataChannel.onopen?.();
      });
      expect(JSON.parse(newDataChannel.send.mock.calls[0]![0] as string)).toMatchObject({
        type: 'mute',
        participantId: 'viewer-1',
        muted: true,
      });
    });
  });
});
