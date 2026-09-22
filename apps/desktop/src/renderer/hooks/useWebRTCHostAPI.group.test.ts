import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebRTCHostAPI } from './useWebRTCHostAPI';

vi.mock('../../shared/config', () => ({ API_BASE_URL: 'http://localhost:3000' }));
vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({ invoke: vi.fn().mockResolvedValue({ token: 'local-test-token' }) }),
}));
vi.mock('@/lib/remoteAudioGain', () => ({
  amplifyRemoteAudio: (track: MediaStreamTrack) => ({
    stream: new MediaStream([track]),
    dispose: vi.fn(),
    setGain: vi.fn(),
  }),
}));

class TestEventSource {
  static latest: TestEventSource;
  listeners = new Map<string, (event: { data: string }) => void>();
  close = vi.fn();
  constructor() {
    TestEventSource.latest = this;
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

class TestStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

function track(id: string, kind = 'audio'): MediaStreamTrack {
  return {
    id,
    kind,
    enabled: true,
    stop: vi.fn(),
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack;
}

class TestPeer {
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  senders: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }[] = [];
  createOffer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'local-offer' })
  );
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
    this.signalingState = description.type === 'rollback' ? 'stable' : 'have-local-offer';
  });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
    this.signalingState = 'stable';
  });
  addTrack = vi.fn((mediaTrack: MediaStreamTrack) => {
    const sender = {
      track: mediaTrack as MediaStreamTrack | null,
      replaceTrack: vi.fn(async (replacement: MediaStreamTrack | null) => {
        sender.track = replacement;
      }),
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn().mockResolvedValue(undefined),
    };
    this.senders.push(sender);
    return sender;
  });
  removeTrack = vi.fn((sender: { track: MediaStreamTrack | null }) => {
    sender.track = null;
  });
  getSenders = () => this.senders;
  getStats = vi.fn().mockResolvedValue(new Map());
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  dataChannel = {
    readyState: 'connecting',
    send: vi.fn(),
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
  };
  createDataChannel = vi.fn(() => this.dataChannel);
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });
}

interface SentSignal {
  type: string;
  targetId: string;
  negotiationId?: string;
  sdp?: string;
}
const signals: SentSignal[] = [];
const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
  signals.push(JSON.parse(init.body as string) as SentSignal);
  return { ok: true, text: async () => '' };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function emit(type: string, data: unknown) {
  await act(async () => {
    TestEventSource.latest.emit(type, data);
    await flush();
  });
}

async function join(id: string) {
  await emit('presence-join', { presences: [{ user_id: id, role: 'viewer' }] });
}

function lastOffer(id: string) {
  return signals.filter((signal) => signal.type === 'offer' && signal.targetId === id).at(-1)!;
}

async function answer(id: string, negotiationId = lastOffer(id).negotiationId) {
  await emit('signal', {
    type: 'answer',
    senderId: id,
    targetId: 'host',
    sdp: 'answer',
    negotiationId,
  });
}

async function setup() {
  const hostMic = track('host-mic');
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(new MediaStream([hostMic])) },
  });
  const localStream = new MediaStream([hostMic]);
  const { result, unmount } = renderHook(() =>
    useWebRTCHostAPI({ sessionId: 'group', hostId: 'host', localStream })
  );
  await act(async () => {
    await result.current.startHosting();
  });
  await emit('connected', {});
  const peer = (id: string) =>
    result.current.viewers.get(id)!.peerConnection as unknown as TestPeer;
  return { result, peer, unmount, hostMic };
}

beforeEach(() => {
  signals.length = 0;
  mockFetch.mockClear();
  vi.stubGlobal('EventSource', TestEventSource);
  vi.stubGlobal('RTCPeerConnection', TestPeer);
  vi.stubGlobal('MediaStream', TestStream);
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal(
    'RTCIceCandidate',
    class {
      constructor(public candidate: unknown) {}
    }
  );
  vi.stubGlobal(
    'Audio',
    class {
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }
  );
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('desktop P2P group negotiation', () => {
  it('does not time out a participant while the final answer is being applied', async () => {
    vi.useFakeTimers();
    const { result, peer } = await setup();
    await join('target');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    const target = peer('target');
    const pending = deferred<undefined>();
    target.setRemoteDescription.mockImplementationOnce(() => pending.promise);
    await answer('target');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(target.close).not.toHaveBeenCalled();
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(3);
    await act(async () => {
      target.signalingState = 'stable';
      pending.resolve(undefined);
      await flush();
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.error).toBeNull();
    expect(target.close).not.toHaveBeenCalled();
  });

  it('uses a new negotiation identity after the host hook remounts', async () => {
    const first = await setup();
    await join('target');
    const old = lastOffer('target');
    first.unmount();
    const second = await setup();
    await join('target');
    expect(lastOffer('target').negotiationId).not.toBe(old.negotiationId);
    await answer('target', old.negotiationId);
    expect(second.peer('target').setRemoteDescription).not.toHaveBeenCalled();
    await answer('target');
    expect(second.peer('target').setRemoteDescription).toHaveBeenCalledOnce();
  });

  it('includes gathered ICE in the retried offer without creating a new negotiation', async () => {
    vi.useFakeTimers();
    const { peer } = await setup();
    await join('target');
    const original = lastOffer('target');
    peer('target').localDescription = { type: 'offer', sdp: 'local-offer-with-gathered-ICE' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(lastOffer('target')).toMatchObject({
      negotiationId: original.negotiationId,
      sdp: 'local-offer-with-gathered-ICE',
    });
    expect(peer('target').createOffer).toHaveBeenCalledTimes(1);
  });

  it('does not let an old data channel reset the rejoined participant', async () => {
    const { result, peer } = await setup();
    await join('target');
    const old = peer('target');
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    await join('target');
    const current = peer('target');
    act(() => {
      current.dataChannel.onopen?.();
      old.dataChannel.onclose?.();
      old.dataChannel.onopen?.();
    });
    expect(result.current.viewers.get('target')?.dataChannel).toBe(current.dataChannel);
  });

  it('ignores queued events from the previous SSE stream after restarting hosting', async () => {
    const { result } = await setup();
    const old = TestEventSource.latest;
    act(() => {
      result.current.stopHosting();
    });
    await act(async () => {
      await result.current.startHosting();
    });
    await emit('connected', {});
    act(() => {
      old.emit('presence-join', { presences: [{ user_id: 'stale', role: 'viewer' }] });
      old.emit('error', {});
    });
    expect(result.current.viewers.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('does not retry a pending HTTP send after the viewer has left', async () => {
    vi.useFakeTimers();
    const { result } = await setup();
    await join('target');
    await answer('target');
    const pending = deferred<{ ok: boolean; text: () => Promise<string> }>();
    mockFetch.mockImplementationOnce(async (_url, init) => {
      signals.push(JSON.parse(init.body as string) as SentSignal);
      return pending.promise;
    });
    let publishing!: Promise<void>;
    await act(async () => {
      publishing = result.current.publishStream(new MediaStream([track('screen', 'video')]));
      await flush();
    });
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    const count = signals.filter((signal) => signal.type === 'offer').length;
    await act(async () => {
      pending.resolve({ ok: true, text: async () => '' });
      await publishing;
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(count);
  });

  it.each(['lost answer', 'HTTP failure', 'network error'])(
    'retries the exact offer after %s',
    async (failure) => {
      vi.useFakeTimers();
      const { peer } = await setup();
      if (failure === 'HTTP failure')
        mockFetch.mockImplementationOnce(async (_url, init) => {
          signals.push(JSON.parse(init.body as string) as SentSignal);
          return { ok: false, text: async () => 'unavailable' };
        });
      if (failure === 'network error')
        mockFetch.mockImplementationOnce(async (_url, init) => {
          signals.push(JSON.parse(init.body as string) as SentSignal);
          throw new Error('network unavailable');
        });
      await join('target');
      const original = lastOffer('target');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(signals.filter((signal) => signal.type === 'offer')).toEqual([original, original]);
      expect(peer('target').createOffer).toHaveBeenCalledTimes(1);
      await answer('target');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(2);
    }
  );

  it('preserves connected media after signaling retries are exhausted and accepts a late answer', async () => {
    vi.useFakeTimers();
    const { result, peer } = await setup();
    await join('target');
    await answer('target');
    const target = peer('target');
    target.connectionState = 'connected';
    await act(async () => {
      await result.current.publishStream(new MediaStream([track('screen', 'video')]));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(target.close).not.toHaveBeenCalled();
    expect(result.current.viewers.has('target')).toBe(true);
    expect(result.current.error).toContain('still connected');
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(4);
    await answer('target');
    expect(target.signalingState).toBe('stable');
    await act(async () => {
      await result.current.unpublishStream();
    });
    expect(target.createOffer).toHaveBeenCalledTimes(3);
  });

  it('bounds retries and reports a rejoin requirement instead of hanging forever', async () => {
    vi.useFakeTimers();
    const { result, peer } = await setup();
    await join('target');
    const target = peer('target');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(3);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(result.current.viewers.has('target')).toBe(false);
    expect(result.current.error).toContain('rejoin');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(3);
  });

  it.each(['leave', 'kick', 'stop'])('cancels pending offer retries on %s', async (action) => {
    vi.useFakeTimers();
    const { result } = await setup();
    await join('target');
    if (action === 'leave') await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    else
      act(() => {
        if (action === 'kick') result.current.kickViewer('target');
        else result.current.stopHosting();
      });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(signals.filter((signal) => signal.type === 'offer')).toHaveLength(1);
  });

  it('contains answer failures and retries without abandoning queued track changes', async () => {
    vi.useFakeTimers();
    const { result, peer } = await setup();
    await join('target');
    peer('target').setRemoteDescription.mockRejectedValueOnce(new Error('bad answer'));
    await answer('target');
    await act(async () => {
      await result.current.publishStream(new MediaStream([track('screen', 'video')]));
    });
    expect(peer('target').createOffer).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await answer('target');
    expect(peer('target').createOffer).toHaveBeenCalledTimes(2);
  });

  it('ignores callbacks from an old peer after the same participant rejoins', async () => {
    const { result, peer } = await setup();
    await join('target');
    const old = peer('target');
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    await join('target');
    const current = peer('target');
    act(() => {
      old.ontrack?.({ track: track('stale-mic') });
      old.onconnectionstatechange?.();
    });
    expect(peer('target')).toBe(current);
    expect(result.current.viewers.get('target')?.audioTrack).toBeNull();
    expect(current.close).not.toHaveBeenCalled();
  });

  it('continues draining ICE after one bad buffered candidate', async () => {
    const { peer } = await setup();
    await join('target');
    await emit('signal', {
      type: 'ice-candidate',
      senderId: 'target',
      candidate: { candidate: 'bad' },
    });
    await emit('signal', {
      type: 'ice-candidate',
      senderId: 'target',
      candidate: { candidate: 'good' },
    });
    peer('target').addIceCandidate.mockRejectedValueOnce(new Error('bad candidate'));
    await answer('target');
    expect(peer('target').addIceCandidate).toHaveBeenCalledTimes(2);
    expect(peer('target').signalingState).toBe('stable');
  });

  it('waits for the first answer before offering a third participant audio', async () => {
    const { peer } = await setup();
    await join('target');
    await join('source');
    const target = peer('target');
    const sourceAudio = track('source-mic');
    await act(async () => {
      peer('source').ontrack?.({ track: sourceAudio });
      await flush();
    });
    expect(target.addTrack).toHaveBeenCalledWith(sourceAudio, expect.anything());
    expect(target.createOffer).toHaveBeenCalledTimes(1);
    await answer('target');
    expect(target.createOffer).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous audio and screen updates while createOffer is pending', async () => {
    const { result, peer } = await setup();
    await join('target');
    await answer('target');
    await join('source');
    await answer('source');
    const target = peer('target');
    const pending = deferred<RTCSessionDescriptionInit>();
    target.createOffer.mockImplementationOnce(() => pending.promise);
    let publishing!: Promise<void>;
    await act(async () => {
      publishing = result.current.publishStream(new MediaStream([track('screen', 'video')]));
      await flush();
      peer('source').ontrack?.({ track: track('source-mic') });
      await flush();
    });
    expect(target.createOffer).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve({ type: 'offer', sdp: 'screen-offer' });
      await publishing;
    });
    await answer('target');
    expect(target.createOffer).toHaveBeenCalledTimes(3);
  });

  it('keeps relay audio updates during a temporary media disconnection', async () => {
    const { peer } = await setup();
    await join('target');
    await answer('target');
    await join('source');
    await answer('source');
    const target = peer('target');
    act(() => {
      target.connectionState = 'disconnected';
      target.onconnectionstatechange?.();
    });
    const audio = track('source-mic');
    await act(async () => {
      peer('source').ontrack?.({ track: audio });
      await flush();
    });
    expect(target.addTrack).toHaveBeenCalledWith(audio, expect.anything());
    expect(target.createOffer).toHaveBeenCalledTimes(2);
  });

  it('publishes and removes screen tracks while reconnecting without removing host audio', async () => {
    const { result, peer, hostMic } = await setup();
    await join('target');
    await answer('target');
    const target = peer('target');
    act(() => {
      target.connectionState = 'disconnected';
      target.onconnectionstatechange?.();
    });
    const video = track('screen', 'video');
    await act(async () => {
      await result.current.publishStream(new MediaStream([video]));
    });
    expect(target.getSenders().some((sender) => sender.track === video)).toBe(true);
    await answer('target');
    await act(async () => {
      await result.current.unpublishStream();
    });
    expect(target.getSenders().some((sender) => sender.track === video)).toBe(false);
    expect(target.getSenders().some((sender) => sender.track === hostMic)).toBe(true);
  });

  it('does not create an offer while applying an answer', async () => {
    const { result, peer } = await setup();
    await join('target');
    const target = peer('target');
    const pending = deferred<undefined>();
    target.setRemoteDescription.mockImplementationOnce(async (description) => {
      target.remoteDescription = description;
      target.signalingState = 'stable';
      await pending.promise;
    });
    await answer('target');
    await act(async () => {
      await result.current.publishStream(new MediaStream([track('screen', 'video')]));
    });
    expect(target.createOffer).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(undefined);
      await flush();
    });
    expect(target.createOffer).toHaveBeenCalledTimes(2);
  });

  it('ignores answers for a different offer but accepts legacy answers', async () => {
    const { peer } = await setup();
    await join('target');
    const target = peer('target');
    expect(lastOffer('target').negotiationId).toEqual(expect.any(String));
    await answer('target', 'old-offer');
    expect(target.setRemoteDescription).not.toHaveBeenCalled();
    await emit('signal', { type: 'answer', senderId: 'target', sdp: 'legacy-answer' });
    expect(target.setRemoteDescription).toHaveBeenCalledTimes(1);
  });

  it('does not signal an offer from a removed peer after createOffer finishes', async () => {
    const { result, peer } = await setup();
    await join('target');
    await answer('target');
    const old = peer('target');
    const pending = deferred<RTCSessionDescriptionInit>();
    old.createOffer.mockImplementationOnce(() => pending.promise);
    let publishing!: Promise<void>;
    await act(async () => {
      publishing = result.current.publishStream(new MediaStream([track('screen', 'video')]));
      await flush();
    });
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    await join('target');
    const current = peer('target');
    const offers = signals.length;
    await act(async () => {
      pending.resolve({ type: 'offer', sdp: 'stale-offer' });
      await publishing;
    });
    expect(signals).toHaveLength(offers);
    expect(peer('target')).toBe(current);
    expect(old.setLocalDescription).toHaveBeenCalledTimes(1);
  });

  it('does not signal an offer from a removed peer after setting its local SDP', async () => {
    const { result, peer } = await setup();
    await join('target');
    await answer('target');
    const pending = deferred<undefined>();
    peer('target').setLocalDescription.mockImplementationOnce(() => pending.promise);
    let publishing!: Promise<void>;
    await act(async () => {
      publishing = result.current.publishStream(new MediaStream([track('screen', 'video')]));
      await flush();
    });
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    const offers = signals.length;
    await act(async () => {
      pending.resolve(undefined);
      await publishing;
    });
    expect(signals).toHaveLength(offers);
  });

  it('coalesces a media change if the answer arrives before the offer POST completes', async () => {
    const { result, peer } = await setup();
    await join('target');
    await answer('target');
    const pending = deferred<{ ok: boolean; text: () => Promise<string> }>();
    mockFetch.mockImplementationOnce(async (_url, init) => {
      signals.push(JSON.parse(init.body as string) as SentSignal);
      return pending.promise;
    });
    let publishing!: Promise<void>;
    await act(async () => {
      publishing = result.current.publishStream(new MediaStream([track('screen', 'video')]));
      await flush();
    });
    await act(async () => {
      await result.current.unpublishStream();
    });
    await answer('target');
    await act(async () => {
      pending.resolve({ ok: true, text: async () => '' });
      await publishing;
      await flush();
    });
    expect(peer('target').createOffer).toHaveBeenCalledTimes(3);
    expect(
      peer('target')
        .getSenders()
        .some((sender) => sender.track?.kind === 'video')
    ).toBe(false);
  });

  it('does not let a stale answer complete a rejoined peer negotiation', async () => {
    const { peer } = await setup();
    await join('target');
    const oldId = lastOffer('target').negotiationId;
    await emit('presence-leave', { presences: [{ user_id: 'target' }] });
    await join('target');
    expect(lastOffer('target').negotiationId).not.toBe(oldId);
    await answer('target', oldId);
    expect(peer('target').setRemoteDescription).not.toHaveBeenCalled();
    await answer('target');
    expect(peer('target').setRemoteDescription).toHaveBeenCalledTimes(1);
  });
});
