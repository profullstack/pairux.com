/**
 * Playback gain for a remote participant's audio.
 *
 * `HTMLMediaElement.volume` is clamped to 1.0, so an `<audio>` or `<video>`
 * element on its own cannot make a quiet talker louder — unity is the ceiling.
 * This routes a remote track through a gain stage and hands back a replacement
 * track to feed the element, which leaves every existing bit of playback
 * plumbing (autoplay retries, mute toggles, sink selection) untouched and keeps
 * the audio leaving by the same output path as before. That matters: the
 * browser's echo canceller references the output mix, so changing where
 * playback exits risks reintroducing the echo we just removed.
 *
 * A limiter sits after the gain. Boosting above unity will otherwise clip on
 * loud syllables, which sounds worse than the quietness being fixed.
 */

import { clampAudioGain, DEFAULT_REMOTE_AUDIO_GAIN } from '@pairux/shared-types';
import { getAudioContext, resumeAudioContext } from './audioContext';

/** Remote audio with a gain stage spliced in front of playback. */
export interface AmplifiedAudioTrack {
  /** Feed this to the media element instead of the raw track. */
  stream: MediaStream;
  /** Adjust playback gain. Values are clamped to the supported range. */
  setGain: (value: number) => void;
  /** Tear down the graph. Safe to call more than once. */
  dispose: () => void;
}

function uniqueTracks(tracks: readonly MediaStreamTrack[]): MediaStreamTrack[] {
  const seenTracks = new Set<MediaStreamTrack>();
  const seenIds = new Set<string>();

  return tracks.filter((track) => {
    if (seenTracks.has(track) || seenIds.has(track.id)) return false;
    seenTracks.add(track);
    seenIds.add(track.id);
    return true;
  });
}

/**
 * Give a remote track a media element to be consumed by.
 *
 * A track arriving over a peer connection is only pulled while something is
 * consuming it, and in Chromium a `MediaStreamAudioSourceNode` does not count:
 * the receiver stays parked and the node reads silence. Routing playback
 * entirely through Web Audio therefore silenced every participant in both
 * directions — the whole call, not just the volume control.
 *
 * A hidden element attached to the *raw* track is what keeps the receiver
 * pulling. It is muted, and must stay muted: an audible second copy of every
 * participant is precisely the double-playback echo removed in v0.9.48. Muting
 * also sidesteps autoplay policy, which never blocks a silent element.
 *
 * The element is returned rather than left to float so the caller can hold a
 * reference. A detached element with no reference is collectable, and taking
 * the consumer away again would put the silence straight back.
 */
function keepRemoteTrackFlowing(track: MediaStreamTrack): HTMLAudioElement {
  const sink = new Audio();
  sink.srcObject = new MediaStream([track]);
  sink.muted = true;
  sink.autoplay = true;
  // Wrapped because `play()` predates its own promise and still returns
  // undefined on some implementations; a bare `.catch` there would throw.
  void Promise.resolve(sink.play()).catch((err: unknown) => {
    console.warn('[RemoteAudioGain] Keep-alive element failed to play:', err);
  });
  return sink;
}

/**
 * Splice one gain stage in front of a set of remote audio tracks.
 *
 * The sources are mixed into one destination track. Although a MediaStream can
 * contain multiple audio tracks, media-element support for playing all of them
 * is inconsistent. One mixed output makes every participant audible on every
 * supported browser and applies the viewer's volume setting uniformly.
 *
 * Throws if Web Audio is unavailable or the track cannot be wired up. That is
 * deliberate: silently playing un-amplified audio would look like the volume
 * control simply not working, which is far harder to diagnose than a failure.
 */
export function amplifyRemoteAudioTracks(
  tracks: readonly MediaStreamTrack[],
  initialGain: number = DEFAULT_REMOTE_AUDIO_GAIN
): AmplifiedAudioTrack {
  const remoteTracks = uniqueTracks(tracks);

  // Avoid opening Web Audio resources for a video-only stream. Keeping this
  // case valid also makes callers safe while tracks are being renegotiated.
  if (remoteTracks.length === 0) {
    return {
      stream: new MediaStream(),
      setGain: () => undefined,
      dispose: () => undefined,
    };
  }

  const ctx = getAudioContext();
  resumeAudioContext(ctx);

  // Before the graph, not after: the source node below reads whatever the
  // receiver has produced, and without a consumer it produces nothing.
  const keepAlives = remoteTracks.map(keepRemoteTrackFlowing);

  const sources = remoteTracks.map((track) =>
    ctx.createMediaStreamSource(new MediaStream([track]))
  );
  const gain = ctx.createGain();
  gain.gain.value = clampAudioGain(initialGain);

  // Catch peaks introduced by the boost rather than letting them clip. A high
  // ratio above a threshold below full scale is a limiter; the fast attack
  // stops transients getting through, and the slower release keeps it from
  // pumping on speech.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  const destination = ctx.createMediaStreamDestination();

  sources.forEach((source) => {
    source.connect(gain);
  });
  gain.connect(limiter);
  limiter.connect(destination);

  // Silent playback is hard to tell apart from nobody talking, so record the
  // state of everything that decides between the two.
  console.log('[RemoteAudioGain] Attached gain stage', {
    trackIds: remoteTracks.map((track) => track.id),
    trackStates: remoteTracks.map((track) => ({
      muted: track.muted,
      readyState: track.readyState,
    })),
    contextState: ctx.state,
    gain: gain.gain.value,
  });

  let disposed = false;

  return {
    stream: destination.stream,
    setGain: (value: number) => {
      if (disposed) return;
      // Ramp rather than jump: an abrupt gain change is an audible click.
      gain.gain.setTargetAtTime(clampAudioGain(value), ctx.currentTime, 0.02);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      sources.forEach((source) => {
        source.disconnect();
      });
      gain.disconnect();
      limiter.disconnect();
      destination.disconnect();
      destination.stream.getTracks().forEach((track) => {
        track.stop();
      });
      keepAlives.forEach((keepAlive) => {
        keepAlive.pause();
        keepAlive.srcObject = null;
      });
    },
  };
}

/** Backwards-compatible single-track form used by host playback. */
export function amplifyRemoteAudio(
  track: MediaStreamTrack,
  initialGain: number = DEFAULT_REMOTE_AUDIO_GAIN
): AmplifiedAudioTrack {
  return amplifyRemoteAudioTracks([track], initialGain);
}
