/**
 * What we need to know about an input, read from `ffmpeg -hide_banner -i <file>`
 * stderr. The bundled desktop ffmpeg (@ffmpeg-installer) ships no ffprobe, so
 * this parses the banner ffmpeg prints before it complains about the missing
 * output.
 */

export interface MediaInfo {
  /** Seconds, or null when the container does not say (MediaRecorder WebM). */
  duration: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export function parseProbe(stderr: string): MediaInfo {
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  const videoLine = /Stream #\d+:\d+[^\n]*?: Video:([^\n]*)/.exec(stderr);
  const size = videoLine?.[1] ? /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine[1]) : null;
  return {
    duration: duration && duration > 0 ? duration : null,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    hasVideo: Boolean(videoLine),
    hasAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(stderr),
  };
}

/** Arguments for the probe call. */
export function probeArgs(source: string): string[] {
  return ['-hide_banner', '-nostdin', '-i', source];
}

/**
 * Arguments that rewrite a file with stream copy so it gets a duration and a
 * seek index. MediaRecorder WebM has neither, which leaves a `<video>` with
 * duration Infinity and a timeline you cannot scrub.
 */
export function remuxArgs(source: string, output: string): string[] {
  return ['-hide_banner', '-nostdin', '-y', '-i', source, '-c', 'copy', output];
}
