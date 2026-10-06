/**
 * An end-to-end encrypted call on PairUX's SFU.
 *
 * The host app (qrypt.chat, or anyone) supplies the media key: 32 random bytes
 * it shares with the other participants over its own encrypted channel. Every
 * audio and video frame is encrypted in the browser (LiveKit E2EE, insertable
 * streams) before it leaves, so the SFU only ever forwards ciphertext and
 * PairUX can neither hear nor see the call. A browser that cannot do E2EE is
 * refused rather than downgraded to a plaintext call.
 *
 *   const call = new PairuxCall({ url, token, iceServers, key });
 *   call.addEventListener('participants', render);
 *   await call.join({ audio: true, video: false });
 */
import {
  ExternalE2EEKeyProvider,
  isE2EESupported,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';

export interface CallOptions {
  /** LiveKit server URL (wss://…), from the partner token endpoint. */
  url: string;
  /** LiveKit access token, from the partner token endpoint. */
  token: string;
  iceServers?: RTCIceServer[];
  /** The media key: 32+ random bytes, shared only between participants. */
  key: Uint8Array | ArrayBuffer;
  /**
   * The LiveKit E2EE worker. Defaults to
   * `new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' })`,
   * which Vite, webpack 5 and Next.js resolve; pass your own if your bundler does not.
   */
  worker?: Worker;
}

export interface CallParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  /** Whether this participant's media is end-to-end encrypted (false = not yet / failed). */
  encrypted: boolean;
}

export type CallState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

/** Detail of the 'track' event: a remote track to play or show. */
export interface CallTrack {
  participantId: string;
  kind: 'audio' | 'video' | 'unknown';
  source: string;
  attach: (el: HTMLMediaElement) => void;
  detach: () => void;
}

const noop = (): void => undefined;

export class E2EEUnsupportedError extends Error {
  constructor() {
    super(
      'This browser cannot end-to-end encrypt calls (no insertable streams). Use a current Chrome, Edge, Firefox or Safari.'
    );
    this.name = 'E2EEUnsupportedError';
  }
}

const toBuffer = (key: Uint8Array | ArrayBuffer): ArrayBuffer => {
  const bytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  if (bytes.byteLength < 32) throw new Error('The media key must be at least 32 bytes.');
  return bytes.slice().buffer;
};

function defaultWorker(): Worker {
  return new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
}

/**
 * Events (CustomEvent): 'state' (detail: CallState), 'participants'
 * (detail: CallParticipant[]), 'track' ({ participantId, kind, attach, detach }),
 * 'error' (detail: Error).
 */
export class PairuxCall extends EventTarget {
  readonly room: Room;
  private keyProvider = new ExternalE2EEKeyProvider();
  private encryptedIds = new Set<string>();
  private options: CallOptions;
  state: CallState = 'idle';

  constructor(options: CallOptions) {
    super();
    if (!isE2EESupported()) throw new E2EEUnsupportedError();
    this.options = options;
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      e2ee: { keyProvider: this.keyProvider, worker: options.worker ?? defaultWorker() },
    });
    this.wire();
  }

  private emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private setState(state: CallState) {
    this.state = state;
    this.emit('state', state);
  }

  private wire() {
    const r = this.room;
    const changed = () => {
      this.emit('participants', this.participants());
    };
    r.on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.TrackMuted, changed)
      .on(RoomEvent.TrackUnmuted, changed)
      .on(RoomEvent.LocalTrackPublished, changed)
      .on(RoomEvent.LocalTrackUnpublished, changed)
      .on(RoomEvent.ActiveSpeakersChanged, changed)
      .on(
        RoomEvent.ParticipantEncryptionStatusChanged,
        (encrypted: boolean, participant?: Participant) => {
          const id = participant?.identity ?? r.localParticipant.identity;
          if (encrypted) this.encryptedIds.add(id);
          else this.encryptedIds.delete(id);
          changed();
        }
      )
      .on(RoomEvent.EncryptionError, (error: Error) => {
        this.emit('error', error);
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
        const detail: CallTrack = {
          participantId: participant.identity,
          kind:
            track.kind === Track.Kind.Audio
              ? 'audio'
              : track.kind === Track.Kind.Video
                ? 'video'
                : 'unknown',
          source: track.source,
          attach: (el) => {
            track.attach(el);
          },
          detach: () => {
            track.detach();
          },
        };
        this.emit('track', detail);
        changed();
      })
      .on(RoomEvent.TrackUnsubscribed, changed)
      .on(RoomEvent.Reconnecting, () => {
        this.setState('reconnecting');
      })
      .on(RoomEvent.Reconnected, () => {
        this.setState('connected');
      })
      .on(RoomEvent.Disconnected, () => {
        this.setState('ended');
      });
  }

  /** Connect with encryption on before a single frame is sent. */
  async join({ audio = true, video = false }: { audio?: boolean; video?: boolean } = {}) {
    this.setState('connecting');
    await this.keyProvider.setKey(toBuffer(this.options.key));
    await this.room.setE2EEEnabled(true);
    await this.room.connect(
      this.options.url,
      this.options.token,
      this.options.iceServers?.length ? { rtcConfig: { iceServers: this.options.iceServers } } : {}
    );
    this.setState('connected');
    if (audio) await this.room.localParticipant.setMicrophoneEnabled(true);
    if (video) await this.room.localParticipant.setCameraEnabled(true);
    this.emit('participants', this.participants());
  }

  /** Rotate to a new media key (e.g. when someone leaves the conversation). */
  async rotateKey(key: Uint8Array | ArrayBuffer) {
    this.options = { ...this.options, key };
    await this.keyProvider.setKey(toBuffer(key));
  }

  async setMic(on: boolean) {
    await this.room.localParticipant.setMicrophoneEnabled(on);
  }

  async setCamera(on: boolean) {
    await this.room.localParticipant.setCameraEnabled(on);
  }

  async setScreen(on: boolean) {
    await this.room.localParticipant.setScreenShareEnabled(on, { audio: true });
  }

  async leave() {
    await this.room.disconnect();
    this.setState('ended');
  }

  /** Everyone in the call, local participant first. */
  participants(): CallParticipant[] {
    const r = this.room;
    const all: Participant[] = [r.localParticipant, ...r.remoteParticipants.values()];
    return all.map((p) => ({
      id: p.identity,
      name: p.name ?? p.identity,
      isLocal: p === r.localParticipant,
      speaking: p.isSpeaking,
      micOn: p.isMicrophoneEnabled,
      cameraOn: p.isCameraEnabled,
      screenOn: p.isScreenShareEnabled,
      encrypted: this.encryptedIds.has(p.identity) || (p === r.localParticipant && r.isE2EEEnabled),
    }));
  }

  /** Attach a participant's camera (or screen) video to an element; returns a detach function. */
  attachVideo(participantId: string, el: HTMLVideoElement, source: 'camera' | 'screen' = 'camera') {
    const r = this.room;
    const p =
      participantId === r.localParticipant.identity
        ? r.localParticipant
        : r.remoteParticipants.get(participantId);
    const pub = p?.getTrackPublication(
      source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera
    );
    const track = pub?.track;
    if (!track) return noop;
    track.attach(el);
    return () => track.detach(el);
  }
}

/** A fresh 32-byte media key, for the host app to share over its own encrypted channel. */
export function newMediaKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
