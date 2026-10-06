import { describe, it, expect, vi, beforeEach } from 'vitest';

const lk = vi.hoisted(() => {
  const order: string[] = [];
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const local = {
    identity: 'me',
    name: 'Me',
    isSpeaking: false,
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    setMicrophoneEnabled: vi.fn(async (on: boolean) => {
      order.push(`mic:${String(on)}`);
      local.isMicrophoneEnabled = on;
    }),
    setCameraEnabled: vi.fn(async (on: boolean) => {
      local.isCameraEnabled = on;
    }),
    setScreenShareEnabled: vi.fn(async () => {}),
    getTrackPublication: vi.fn(() => undefined),
  };
  const room = {
    localParticipant: local,
    remoteParticipants: new Map(),
    isE2EEEnabled: false,
    on(ev: string, fn: (...a: unknown[]) => void) {
      handlers.set(ev, fn);
      return room;
    },
    setE2EEEnabled: vi.fn(async (on: boolean) => {
      order.push(`e2ee:${String(on)}`);
      room.isE2EEEnabled = on;
    }),
    connect: vi.fn(async () => {
      order.push('connect');
    }),
    disconnect: vi.fn(async () => {}),
  };
  return {
    order,
    handlers,
    room,
    local,
    supported: { value: true },
    roomOptions: { value: undefined as unknown },
  };
});

vi.mock('livekit-client', () => ({
  isE2EESupported: () => lk.supported.value,
  ExternalE2EEKeyProvider: class {
    setKey = vi.fn(async (k: ArrayBuffer) => {
      lk.order.push(`key:${String(k.byteLength)}`);
    });
  },
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- stands in for livekit's Room constructor
  Room: class {
    constructor(opts: unknown) {
      lk.roomOptions.value = opts;
      return lk.room as never;
    }
  },
  RoomEvent: new Proxy({}, { get: (_t, p) => String(p) }),
  Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share' } },
}));

const { PairuxCall, E2EEUnsupportedError, newMediaKey } = await import('./call.js');
const { mountCall } = await import('./widget.js');

const worker = {} as Worker;
const opts = { url: 'wss://sfu.pairux.com', token: 't', key: new Uint8Array(32).fill(7), worker };

beforeEach(() => {
  lk.order.length = 0;
  lk.supported.value = true;
  lk.local.isMicrophoneEnabled = false;
});

describe('PairuxCall', () => {
  it('refuses a browser that cannot encrypt rather than calling in plaintext', () => {
    lk.supported.value = false;
    expect(() => new PairuxCall(opts)).toThrow(E2EEUnsupportedError);
  });

  it('sets the key and turns encryption on before connecting, then publishes', async () => {
    const call = new PairuxCall(opts);
    expect((lk.roomOptions.value as { e2ee: { worker: Worker } }).e2ee.worker).toBe(worker);
    await call.join({ audio: true });
    expect(lk.order).toEqual(['key:32', 'e2ee:true', 'connect', 'mic:true']);
    expect(call.state).toBe('connected');
    expect(call.participants()[0]).toMatchObject({
      id: 'me',
      isLocal: true,
      micOn: true,
      encrypted: true,
    });
  });

  it('rejects a short key', async () => {
    const call = new PairuxCall({ ...opts, key: new Uint8Array(8) });
    await expect(call.join()).rejects.toThrow(/at least 32 bytes/);
    expect(lk.room.connect).not.toHaveBeenCalledWith(expect.anything(), 'never');
  });

  it('makes 32-byte random keys', () => {
    const a = newMediaKey();
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(newMediaKey()))).toBe(false);
  });
});

describe('mountCall', () => {
  it('renders a tile per participant and drives the call from its controls', async () => {
    const call = new PairuxCall(opts);
    await call.join({ audio: true });
    const el = document.createElement('div');
    const ui = mountCall(el, call);
    expect(el.querySelectorAll('.pxe-tile')).toHaveLength(1);
    expect(el.querySelector('.pxe-name')?.textContent).toContain('Me (you)');
    expect(el.querySelector('.pxe-status')?.textContent).toContain('End-to-end encrypted');
    const mute = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Mute')!;
    mute.click();
    await vi.waitFor(() => expect(lk.local.setMicrophoneEnabled).toHaveBeenLastCalledWith(false));
    ui.destroy();
    expect(el.children).toHaveLength(0);
  });
});
