/**
 * Shared voice-audio settings.
 *
 * Every client captures the microphone for a live two-way call, so they all
 * want the same thing: the browser's voice processing chain on, one channel,
 * and an Opus stream that survives packet loss. Keeping the values here means
 * desktop, web and mobile cannot drift apart — a mic captured with echo
 * cancellation on one end and off on the other is what produces the classic
 * "only one person hears the echo" report.
 */

/**
 * Constraints for a microphone captured for a call.
 *
 * `echoCancellation` is the important one: without it the remote party's voice
 * coming out of the speakers is picked straight back up by the mic and sent
 * home. Browsers default it on for `audio: true`, but react-native-webrtc does
 * not, and an explicit request also makes the intent reviewable.
 *
 * Mono at 48 kHz matches what Opus encodes anyway; asking for stereo just
 * doubles the bitrate for no gain on a voice call.
 */
export const VOICE_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
} as const;

/**
 * Constraints for a microphone captured by react-native-webrtc.
 *
 * Deliberately narrower than {@link VOICE_AUDIO_CONSTRAINTS}. On Android every
 * key in this object is forwarded to `createAudioSource` as a *mandatory*
 * native constraint, so anything libwebrtc does not recognise is at best
 * ignored — `sampleRate` and `channelCount` are not audio-source constraints
 * there, and passing them buys nothing while widening the blast radius.
 *
 * Both spellings of each flag are sent: libwebrtc's constraint table has
 * historically keyed on the `goog`-prefixed names, and accepts the spec names
 * on newer builds. Sending both means the audio processing chain turns on
 * whichever table the linked WebRTC build happens to use.
 */
export const MOBILE_VOICE_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  googEchoCancellation: true,
  googNoiseSuppression: true,
  googAutoGainControl: true,
} as const;

/**
 * Constraints for the audio that rides along with a screen share.
 *
 * This is system/tab loopback, not a microphone, so gain control and noise
 * suppression would chew up music and video. Echo cancellation stays on
 * because on some platforms loopback capture can otherwise re-capture the
 * call audio itself.
 */
export const SYSTEM_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

/**
 * Target Opus bitrate for speech, in bits per second.
 *
 * 32k is enough to be *intelligible*, which is why it is a common default, but
 * it sounds noticeably compressed — thin, and a bit distant. Voice is the point
 * of a pairing call and this is rounding error next to a screen share measured
 * in megabits, so it is worth spending. Past roughly 64k mono the returns on
 * speech are negligible.
 */
export const OPUS_TARGET_BITRATE = 48000;

/**
 * Playback gain applied to a remote participant's audio.
 *
 * An `<audio>`/`<video>` element clamps `.volume` to 1.0, so unity is the
 * loudest an element can go on its own — there is no headroom to make a quiet
 * talker comfortable. Routing the track through a gain stage first is the only
 * way to exceed that.
 *
 * The default is 2.0 rather than 1.0 deliberately: playback used to run through
 * two summed paths at once (an element *and* the AudioContext), which was an
 * accidental ~+6 dB. Removing the duplicate fixed the smearing it caused but
 * halved everyone's level, so 2.0 restores the loudness people were used to
 * without the doubling artifact.
 */
export const DEFAULT_REMOTE_AUDIO_GAIN = 2;

/** Bounds for {@link DEFAULT_REMOTE_AUDIO_GAIN}, as exposed to a volume control. */
export const MIN_REMOTE_AUDIO_GAIN = 0;
export const MAX_REMOTE_AUDIO_GAIN = 4;

/**
 * Clamp a playback gain into the supported range.
 *
 * Non-finite input (a `NaN` from parsing a slider, say) falls back to the
 * default rather than silencing the call or blowing the limiter apart.
 */
export function clampAudioGain(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REMOTE_AUDIO_GAIN;
  return Math.min(MAX_REMOTE_AUDIO_GAIN, Math.max(MIN_REMOTE_AUDIO_GAIN, value));
}

/**
 * Encoding parameters for an audio RTP sender.
 *
 * Audio is tiny next to screen video but matters far more, so it is marked
 * high priority in both the local encoder queue (`priority`) and the DSCP
 * markings on the wire (`networkPriority`). Without this, a screen share that
 * is allowed several megabits will win the bandwidth allocator's attention and
 * leave the voice stream to stutter.
 */
export const AUDIO_ENCODING_PARAMS = {
  maxBitrate: OPUS_TARGET_BITRATE,
  priority: 'high',
  networkPriority: 'high',
} as const;

/**
 * Network priority for a screen-share video sender.
 *
 * Deliberately below audio. Video can drop resolution or framerate and stay
 * usable; audio cannot drop anything without becoming choppy.
 */
export const VIDEO_NETWORK_PRIORITY = 'low';

/**
 * Tell the stack that an audio track carries speech.
 *
 * `contentHint` lets the encoder and the processing chain optimise for voice
 * rather than guessing from the signal — the audio equivalent of the `'detail'`
 * hint already set on screen-share video. Harmless where unsupported: the
 * property simply stays unset.
 *
 * Takes a bare `object` because react-native-webrtc's `MediaStreamTrack` type
 * declares no `contentHint` at all, and a structural interface with no
 * overlapping properties is rejected outright rather than merely narrowed.
 */
export function markTrackAsSpeech(track: object | null | undefined): void {
  if (!track) return;
  try {
    (track as { contentHint?: string }).contentHint = 'speech';
  } catch {
    // Read-only or absent on this platform — nothing to do.
  }
}

/**
 * The slice of `RTCRtpSender` this module needs.
 *
 * Declared structurally so the same implementation works against the DOM's
 * `RTCRtpSender` and react-native-webrtc's, which are unrelated types.
 */
interface RtpSenderLike<P> {
  getParameters(): P;
  setParameters(parameters: P): Promise<void>;
}

interface EncodingLike {
  maxBitrate?: number;
  priority?: string;
  networkPriority?: string;
}

/**
 * Mark an audio sender as the highest-priority stream on the connection.
 *
 * Call this for every audio track added to a peer connection. Without it, a
 * screen share allowed several megabits wins the bandwidth allocator and the
 * voice stream stutters — audio is only ~32 kbps, so it costs nothing to
 * always serve it first.
 *
 * Failures are swallowed: priority is an optimisation, and a browser that
 * rejects the parameters should not take the call down with it.
 */
export async function prioritizeAudioSender<P extends { encodings?: unknown }>(
  sender: RtpSenderLike<P>
): Promise<void> {
  try {
    const params = sender.getParameters();
    const encodings = params.encodings as EncodingLike[] | undefined;
    // Before the first negotiation completes some stacks report no encodings.
    if (!encodings || encodings.length === 0) return;

    for (const encoding of encodings) {
      encoding.maxBitrate = AUDIO_ENCODING_PARAMS.maxBitrate;
      encoding.priority = AUDIO_ENCODING_PARAMS.priority;
      encoding.networkPriority = AUDIO_ENCODING_PARAMS.networkPriority;
    }

    await sender.setParameters(params);
  } catch {
    // Non-fatal — the call works, just without explicit prioritisation.
  }
}

/** Payload types for Opus, parsed out of an m=audio line's rtpmap entries. */
function findOpusPayloadTypes(sdp: string): string[] {
  const types: string[] = [];
  // e.g. "a=rtpmap:111 opus/48000/2"
  const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000/gim;
  let match: RegExpExecArray | null;
  while ((match = rtpmap.exec(sdp)) !== null) {
    const payloadType = match[1];
    if (payloadType !== undefined) types.push(payloadType);
  }
  return types;
}

/**
 * Rewrite an `a=fmtp` parameter list, replacing keys we manage and keeping
 * any the browser set that we do not care about.
 */
function mergeFmtpParams(existing: string, overrides: Record<string, string>): string {
  const params = new Map<string, string>();

  for (const entry of existing.split(';')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      params.set(trimmed, '');
    } else {
      params.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    params.set(key, value);
  }

  return [...params.entries()]
    .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
    .join(';');
}

/**
 * Tune the Opus codec in an SDP for a voice call.
 *
 * Turns on in-band forward error correction and pins a bitrate appropriate for
 * speech. FEC is what turns a lost packet into a slightly duller syllable
 * instead of a gap, which is the difference between "choppy" and "fine" on a
 * lossy link.
 *
 * DTX is explicitly *off*. It saves bandwidth by going silent between phrases
 * and letting the far end synthesise comfort noise, but the handover in and out
 * of that synthetic noise is audible: room tone appears and disappears, and the
 * tails of words get clipped. On a conversation that people sit inside for
 * hours it reads as an unnatural, gated quality. The bandwidth it saves is not
 * worth it here. Set explicitly rather than omitted so it also overrides a
 * stack that would otherwise default it on.
 *
 * Unknown or Opus-free SDP is returned untouched, so this is safe to run over
 * every offer and answer.
 */
export function tuneOpusForVoice(sdp: string): string {
  const payloadTypes = findOpusPayloadTypes(sdp);
  if (payloadTypes.length === 0) return sdp;

  const overrides: Record<string, string> = {
    stereo: '0',
    'sprop-stereo': '0',
    useinbandfec: '1',
    usedtx: '0',
    maxaveragebitrate: String(OPUS_TARGET_BITRATE),
  };

  // SDP uses CRLF, but some stacks hand back bare LF. Split on either and
  // rejoin with whatever the input used so we do not corrupt the message.
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r\n|\n/);
  const seen = new Set<string>();

  const tuned = lines.map((line) => {
    for (const pt of payloadTypes) {
      const prefix = `a=fmtp:${pt} `;
      if (line.startsWith(prefix)) {
        seen.add(pt);
        return prefix + mergeFmtpParams(line.slice(prefix.length), overrides);
      }
    }
    return line;
  });

  // Opus without an fmtp line at all: add one right after its rtpmap.
  for (const pt of payloadTypes) {
    if (seen.has(pt)) continue;
    const rtpmapIndex = tuned.findIndex((line) => line.startsWith(`a=rtpmap:${pt} opus/48000`));
    if (rtpmapIndex === -1) continue;
    tuned.splice(rtpmapIndex + 1, 0, `a=fmtp:${pt} ${mergeFmtpParams('', overrides)}`);
  }

  return tuned.join(eol);
}
