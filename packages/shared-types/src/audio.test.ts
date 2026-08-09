import { describe, it, expect } from 'vitest';
import {
  VOICE_AUDIO_CONSTRAINTS,
  SYSTEM_AUDIO_CONSTRAINTS,
  AUDIO_ENCODING_PARAMS,
  DEFAULT_REMOTE_AUDIO_GAIN,
  MAX_REMOTE_AUDIO_GAIN,
  OPUS_TARGET_BITRATE,
  clampAudioGain,
  markTrackAsSpeech,
  tuneOpusForVoice,
  prioritizeAudioSender,
} from './audio.js';

const OPUS_SDP = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=0',
  'a=rtpmap:63 red/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000',
].join('\r\n');

describe('voice audio constraints', () => {
  it('requests echo cancellation so the remote voice is not sent back', () => {
    expect(VOICE_AUDIO_CONSTRAINTS.echoCancellation).toBe(true);
    expect(VOICE_AUDIO_CONSTRAINTS.noiseSuppression).toBe(true);
    expect(VOICE_AUDIO_CONSTRAINTS.autoGainControl).toBe(true);
  });

  it('captures mono, since stereo doubles bitrate for no gain on voice', () => {
    expect(VOICE_AUDIO_CONSTRAINTS.channelCount).toBe(1);
  });

  it('leaves loopback audio unprocessed apart from echo cancellation', () => {
    expect(SYSTEM_AUDIO_CONSTRAINTS.noiseSuppression).toBe(false);
    expect(SYSTEM_AUDIO_CONSTRAINTS.autoGainControl).toBe(false);
  });
});

describe('audio encoding params', () => {
  it('ranks audio above video for bandwidth', () => {
    expect(AUDIO_ENCODING_PARAMS.priority).toBe('high');
    expect(AUDIO_ENCODING_PARAMS.networkPriority).toBe('high');
  });
});

describe('tuneOpusForVoice', () => {
  it('turns on in-band FEC so lost packets are concealed, not dropped', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('useinbandfec=1');
    expect(tuned).not.toContain('useinbandfec=0');
  });

  it('pins a speech bitrate with enough headroom to not sound thin', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('maxaveragebitrate=48000');
  });

  it('disables DTX, whose comfort-noise handover sounds gated', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('usedtx=0');
    expect(tuned).not.toContain('usedtx=1');
  });

  it('overrides DTX even when the stack already asked for it', () => {
    const sdp = OPUS_SDP.replace('minptime=10;useinbandfec=0', 'minptime=10;usedtx=1');
    expect(tuneOpusForVoice(sdp)).toContain('usedtx=0');
  });

  it('forces mono', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('stereo=0');
    expect(tuned).toContain('sprop-stereo=0');
  });

  it('keeps fmtp parameters it does not manage', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('minptime=10');
  });

  it('leaves the video section alone', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('a=rtpmap:96 VP8/90000');
    expect(tuned).not.toMatch(/a=fmtp:96/);
  });

  it('adds an fmtp line when Opus has none', () => {
    const sdp = ['m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2'].join('\r\n');
    const tuned = tuneOpusForVoice(sdp);
    expect(tuned).toContain('a=fmtp:111 ');
    expect(tuned).toContain('useinbandfec=1');
  });

  it('returns SDP without Opus untouched', () => {
    const sdp = ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000'].join('\r\n');
    expect(tuneOpusForVoice(sdp)).toBe(sdp);
  });

  it('preserves CRLF line endings', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP);
    expect(tuned).toContain('\r\n');
    expect(tuned.split('\r\n').length).toBe(OPUS_SDP.split('\r\n').length);
  });

  it('handles bare LF line endings without corrupting the message', () => {
    const tuned = tuneOpusForVoice(OPUS_SDP.replace(/\r\n/g, '\n'));
    expect(tuned).not.toContain('\r');
    expect(tuned).toContain('useinbandfec=1');
  });
});

describe('remote audio gain', () => {
  it('defaults above unity, which an element alone cannot reach', () => {
    expect(DEFAULT_REMOTE_AUDIO_GAIN).toBeGreaterThan(1);
  });

  it('clamps to the supported range', () => {
    expect(clampAudioGain(-5)).toBe(0);
    expect(clampAudioGain(99)).toBe(MAX_REMOTE_AUDIO_GAIN);
    expect(clampAudioGain(1.5)).toBe(1.5);
  });

  it('falls back to the default for any non-finite value', () => {
    expect(clampAudioGain(NaN)).toBe(DEFAULT_REMOTE_AUDIO_GAIN);
    expect(clampAudioGain(Infinity)).toBe(DEFAULT_REMOTE_AUDIO_GAIN);
    expect(clampAudioGain(-Infinity)).toBe(DEFAULT_REMOTE_AUDIO_GAIN);
  });

  it('allows silence', () => {
    expect(clampAudioGain(0)).toBe(0);
  });
});

describe('markTrackAsSpeech', () => {
  it('hints that the track carries speech', () => {
    const track: { contentHint?: string } = {};
    markTrackAsSpeech(track);
    expect(track.contentHint).toBe('speech');
  });

  it('tolerates a missing track', () => {
    expect(() => {
      markTrackAsSpeech(null);
    }).not.toThrow();
  });

  it('tolerates a platform where the property is read-only', () => {
    const track = {};
    Object.defineProperty(track, 'contentHint', {
      get: () => '',
      set: () => {
        throw new Error('read-only');
      },
    });
    expect(() => {
      markTrackAsSpeech(track);
    }).not.toThrow();
  });
});

describe('prioritizeAudioSender', () => {
  interface FakeSender {
    params: { encodings: unknown };
    applied: unknown[];
    getParameters: () => { encodings: unknown };
    setParameters: (next: { encodings: unknown }) => Promise<void>;
  }

  function makeSender(encodings: unknown): FakeSender {
    const params = { encodings };
    const applied: unknown[] = [];
    return {
      params,
      applied,
      getParameters: (): { encodings: unknown } => params,
      setParameters: (next: { encodings: unknown }): Promise<void> => {
        applied.push(next);
        return Promise.resolve();
      },
    };
  }

  it('marks every encoding high priority', async () => {
    const sender = makeSender([{}]);
    await prioritizeAudioSender(sender);

    expect(sender.applied).toHaveLength(1);
    expect(sender.params.encodings).toEqual([
      { maxBitrate: OPUS_TARGET_BITRATE, priority: 'high', networkPriority: 'high' },
    ]);
  });

  it('does nothing when the stack reports no encodings yet', async () => {
    const sender = makeSender(undefined);
    await prioritizeAudioSender(sender);
    expect(sender.applied).toHaveLength(0);
  });

  it('does nothing for an empty encodings list', async () => {
    const sender = makeSender([]);
    await prioritizeAudioSender(sender);
    expect(sender.applied).toHaveLength(0);
  });

  it('swallows setParameters failures rather than failing the call', async () => {
    const sender = {
      getParameters: (): { encodings: unknown[] } => ({ encodings: [{}] }),
      setParameters: (): Promise<void> => Promise.reject(new Error('InvalidModificationError')),
    };
    await expect(prioritizeAudioSender(sender)).resolves.toBeUndefined();
  });
});
