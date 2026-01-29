/**
 * Audio mixer hook using Web Audio API
 *
 * Combines multiple audio tracks (host mic + remote viewer audio) into a single
 * MediaStream output suitable for recording via MediaRecorder. Sources can be
 * added and removed dynamically — the AudioContext graph is live, so the
 * MediaRecorder automatically picks up changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface AudioSource {
  id: string;
  trackId: string;
  sourceNode: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  playback: boolean;
}

export function useAudioMixer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef<Map<string, AudioSource>>(new Map());
  const [mixedStream, setMixedStream] = useState<MediaStream | null>(null);

  // Lazily create AudioContext + destination on first use
  const ensureContext = useCallback((): {
    ctx: AudioContext;
    destination: MediaStreamAudioDestinationNode;
  } | null => {
    if (audioContextRef.current && destinationRef.current) {
      return { ctx: audioContextRef.current, destination: destinationRef.current };
    }

    try {
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();

      audioContextRef.current = ctx;
      destinationRef.current = destination;
      setMixedStream(destination.stream);

      console.log('[AudioMixer] Initialized AudioContext');
      return { ctx, destination };
    } catch (err) {
      console.error('[AudioMixer] Failed to create AudioContext:', err);
      return null;
    }
  }, []);

  // Add an audio track to the mix
  // When playback is true, the track is also routed to speakers (ctx.destination)
  // If a track with the same id already exists but the underlying MediaStreamTrack
  // changed (e.g. SFU re-published after unmute), the old source is replaced.
  const addTrack = useCallback(
    (id: string, track: MediaStreamTrack, playback = false) => {
      const existing = sourcesRef.current.get(id);
      if (existing) {
        // Same underlying track — nothing to do
        if (existing.trackId === track.id) return;
        // Track changed (e.g. SFU re-publish after unmute) — tear down old source
        try {
          existing.gainNode.disconnect();
          existing.sourceNode.disconnect();
        } catch {
          // Already disconnected
        }
        sourcesRef.current.delete(id);
        console.log(`[AudioMixer] Replacing stale track: ${id}`);
      }

      const result = ensureContext();
      if (!result) return;
      const { ctx, destination } = result;

      // Resume context if suspended (e.g. autoplay policy)
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const sourceNode = ctx.createMediaStreamSource(new MediaStream([track]));
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      sourceNode.connect(gainNode);
      // Always connect to recording destination
      gainNode.connect(destination);
      // Also connect to speakers when playback is enabled (e.g. viewer audio)
      if (playback) {
        gainNode.connect(ctx.destination);
      }

      sourcesRef.current.set(id, { id, trackId: track.id, sourceNode, gainNode, playback });
      console.log(
        `[AudioMixer] Added track: ${id} (${String(sourcesRef.current.size)} sources, playback=${String(playback)})`
      );
    },
    [ensureContext]
  );

  // Remove an audio track from the mix
  const removeTrack = useCallback((id: string) => {
    const source = sourcesRef.current.get(id);
    if (!source) return;

    try {
      source.gainNode.disconnect();
      source.sourceNode.disconnect();
    } catch {
      // Already disconnected
    }

    sourcesRef.current.delete(id);
    console.log(`[AudioMixer] Removed track: ${id} (${String(sourcesRef.current.size)} sources)`);
  }, []);

  // Mute/unmute a specific track (sets gain to 0 or 1)
  const setTrackMuted = useCallback((id: string, muted: boolean) => {
    const source = sourcesRef.current.get(id);
    if (source) {
      source.gainNode.gain.value = muted ? 0 : 1;
      // Resume context if it auto-suspended while tracks were muted
      if (!muted && audioContextRef.current?.state === 'suspended') {
        void audioContextRef.current.resume();
      }
    }
  }, []);

  // Tear down the mixer
  const dispose = useCallback(() => {
    for (const source of sourcesRef.current.values()) {
      try {
        source.gainNode.disconnect();
        source.sourceNode.disconnect();
      } catch {
        // Already disconnected
      }
    }
    sourcesRef.current.clear();

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    destinationRef.current = null;
    setMixedStream(null);

    console.log('[AudioMixer] Disposed');
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    /** The output MediaStream containing mixed audio from all added tracks */
    mixedStream,
    addTrack,
    removeTrack,
    setTrackMuted,
    dispose,
  };
}
