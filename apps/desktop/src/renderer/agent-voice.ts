import { Room, RoomEvent, Track } from 'livekit-client';

interface VoiceConnectConfig {
  token: string;
  url: string;
  iceServers?: RTCIceServer[];
}

interface VoiceCommand {
  type: 'connect' | 'speak' | 'stop';
  payload?: VoiceConnectConfig | ArrayBuffer;
}

interface AgentVoiceBridge {
  onCommand(callback: (command: VoiceCommand) => void): () => void;
  send(event: { type: string; text?: string; error?: string; audio?: Uint8Array }): void;
}

declare global {
  interface Window {
    agentVoice: AgentVoiceBridge;
  }
}

const bridge = window.agentVoice;
let room: Room | null = null;
let audioContext: AudioContext | null = null;
let mixer: GainNode | null = null;
let processor: AudioWorkletNode | null = null;
let mutedOutput: GainNode | null = null;
let ttsDestination: MediaStreamAudioDestinationNode | null = null;
let capturing = false;
let intentionalDisconnect = false;
let pendingSamples: number[] = [];
const tracks = new Map<string, { source: MediaStreamAudioSourceNode; track: MediaStreamTrack }>();

const CHUNK_SECONDS = 5;
const STT_RATE = 16_000;

function sendError(error: unknown) {
  bridge.send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
}

function encodeWav(input: Float32Array, sourceRate: number): Uint8Array {
  const ratio = sourceRate / STT_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const bytes = new Uint8Array(44 + outputLength * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + outputLength * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, STT_RATE, true);
  view.setUint32(28, STT_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, outputLength * 2, true);
  for (let index = 0; index < outputLength; index++) {
    const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

function handlePcm(channel: Float32Array) {
  if (!capturing) return;
  for (const sample of channel) {
    pendingSamples.push(sample);
  }
  const wanted = Math.floor((audioContext?.sampleRate ?? 48_000) * CHUNK_SECONDS);
  if (pendingSamples.length < wanted) return;

  const audio = new Float32Array(pendingSamples.splice(0, wanted));
  let squareSum = 0;
  for (const sample of audio) squareSum += sample * sample;
  const rms = Math.sqrt(squareSum / audio.length);
  if (rms < 0.003) return;
  bridge.send({ type: 'audio', audio: encodeWav(audio, audioContext?.sampleRate ?? 48_000) });
}

function addRemoteAudio(track: MediaStreamTrack, sid: string) {
  if (!audioContext || !mixer || tracks.has(sid)) return;
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  source.connect(mixer);
  tracks.set(sid, { source, track });
}

function removeRemoteAudio(sid: string) {
  const entry = tracks.get(sid);
  if (!entry) return;
  entry.source.disconnect();
  tracks.delete(sid);
}

async function connect(config: VoiceConnectConfig) {
  if (room) {
    intentionalDisconnect = true;
    await room.disconnect();
    room = null;
    tracks.clear();
  }
  if (!audioContext) {
    audioContext = new AudioContext();
    await audioContext.resume();
    await audioContext.audioWorklet.addModule(
      new URL('./agent-voice-worklet.js', window.location.href)
    );
    mixer = audioContext.createGain();
    mixer.channelCount = 1;
    mixer.channelCountMode = 'explicit';
    processor = new AudioWorkletNode(audioContext, 'pairux-voice-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
    });
    processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
      handlePcm(event.data);
    };
    mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;
    ttsDestination = audioContext.createMediaStreamDestination();
    mixer.connect(processor);
    processor.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);
  }

  const nextRoom = new Room({ adaptiveStream: false, dynacast: false });
  room = nextRoom;
  nextRoom.on(RoomEvent.TrackSubscribed, (track, publication) => {
    if (track.kind === Track.Kind.Audio) {
      addRemoteAudio(track.mediaStreamTrack, publication.trackSid);
    }
  });
  nextRoom.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
    removeRemoteAudio(publication.trackSid);
  });
  nextRoom.on(RoomEvent.Disconnected, (reason) => {
    if (!intentionalDisconnect) {
      bridge.send({ type: 'disconnected', error: reason ? String(reason) : undefined });
    }
    intentionalDisconnect = false;
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await nextRoom.connect(config.url, config.token, {
        rtcConfig: config.iceServers ? { iceServers: config.iceServers } : undefined,
      });
      break;
    } catch (error) {
      await nextRoom.disconnect().catch(() => undefined);
      if (attempt === 2) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  if (!ttsDestination) throw new Error('Audio output is unavailable');
  const outgoing = ttsDestination.stream.getAudioTracks()[0];
  await nextRoom.localParticipant.publishTrack(outgoing, { source: Track.Source.Microphone });
  capturing = true;
  bridge.send({ type: 'connected' });
}

async function speak(audio: ArrayBuffer) {
  if (!audioContext || !ttsDestination) throw new Error('Voice call has not connected yet');
  await audioContext.resume();
  const copy = audio.slice(0);
  const buffer = await audioContext.decodeAudioData(copy);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(ttsDestination);
  source.onended = () => {
    source.disconnect();
  };
  source.start();
}

async function stop() {
  capturing = false;
  pendingSamples = [];
  for (const sid of tracks.keys()) removeRemoteAudio(sid);
  if (room) await room.disconnect().catch(() => undefined);
  room = null;
  if (processor) processor.disconnect();
  if (mixer) mixer.disconnect();
  if (mutedOutput) mutedOutput.disconnect();
  await audioContext?.close().catch(() => undefined);
  audioContext = null;
}

bridge.onCommand((command) => {
  if (command.type === 'connect') {
    void connect(command.payload as VoiceConnectConfig).catch(sendError);
  } else if (command.type === 'speak') {
    void speak(command.payload as ArrayBuffer).catch((error: unknown) => {
      bridge.send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    });
  } else {
    void stop();
  }
});

bridge.send({ type: 'ready' });
