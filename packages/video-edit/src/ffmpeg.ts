/**
 * Compile an EditPlan into one ffmpeg invocation.
 *
 * Shape of the graph:
 *
 *   keep range i  ──(-ss S -t D -i source)──► normalize ─┐
 *   ...                                                   ├─ concat ─► fade in/out ─┐
 *   intro (file | image | title) ──► normalize ─► fades ──────────────────────────────┼─ concat ─► out
 *   outro                         ──► normalize ─► fades ──────────────────────────────┘
 *
 * Each keep range is its own input with input-side seeking, so cutting five
 * minutes out of minute 40 of an hour-long recording decodes five minutes,
 * not forty-five. Every piece is normalized to one size, frame rate, pixel
 * format and audio layout so concat accepts it, and every piece without audio
 * gets generated silence so the output always has an audio track.
 */

import { keptDuration, type Bumper, type EditPlan } from './plan.js';
import type { MediaInfo } from './probe.js';

export interface CompileInput {
  /** The recording: a local path or an http(s) URL ffmpeg can seek. */
  source: string;
  sourceInfo: MediaInfo;
  /** Probe results for file bumpers (needed for their duration and audio). */
  introInfo?: MediaInfo | null | undefined;
  outroInfo?: MediaInfo | null | undefined;
  /** Where to write the result. */
  output: string;
  /** A TTF/OTF for title cards; otherwise fontconfig's "Sans". */
  fontFile?: string | null | undefined;
  /** x264/VP9 speed preset trade-off. */
  quality?: 'fast' | 'balanced' | 'high' | undefined;
}

export interface CompiledEdit {
  args: string[];
  /** Length of the output in seconds, for progress. */
  duration: number;
  width: number;
  height: number;
  fps: number;
}

const DEFAULT_FPS = 30;
const AUDIO_NORM = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';

function n(v: number): string {
  // ffmpeg accepts plain decimals; avoid exponent notation and float noise.
  return Number(v.toFixed(3)).toString();
}

function evenOr(v: number | null | undefined, fallback: number): number {
  if (!v || !Number.isFinite(v)) return fallback;
  const r = Math.round(v);
  return r % 2 === 0 ? r : r - 1;
}

/**
 * Escape a value for a drawtext option inside a filtergraph. Two levels: the
 * option parser (`\` and `:`) and then the graph parser (`\`, `'`, `[`, `]`,
 * `,`, `;`). Arguments go to ffmpeg as an argv array, never through a shell,
 * so no third level is needed. Straight apostrophes become typographic ones,
 * which reads the same on a title card and sidesteps the quote rules.
 */
export function escapeDrawtext(value: string): string {
  const level1 = value
    .replace(/'/g, '’')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:');
  return level1.replace(/\\/g, '\\\\').replace(/([[\],;'])/g, '\\$1');
}

function hexColor(hex: string | undefined, fallback: string): string {
  return `0x${(hex ?? fallback).replace('#', '')}`;
}

export function compileEdit(plan: EditPlan, input: CompileInput): CompiledEdit {
  const { sourceInfo } = input;
  if (!sourceInfo.hasVideo) throw new Error('The recording has no video track');
  const width = plan.output?.width ?? evenOr(sourceInfo.width, 1280);
  const height = plan.output?.height ?? evenOr(sourceInfo.height, 720);
  const fps = plan.output?.fps ?? DEFAULT_FPS;
  const format = plan.output?.format ?? 'mp4';

  const vnorm = [
    `scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease`,
    `pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${String(fps)}`,
    'format=yuv420p',
  ].join(',');

  const inputs: string[] = [];
  const filters: string[] = [];
  let inputIndex = 0;
  const addInput = (...args: string[]): number => {
    inputs.push(...args);
    return inputIndex++;
  };

  // --- Main content: one seeked input per keep range ----------------------
  const mainLabels: string[] = [];
  plan.keep.forEach((range, i) => {
    const d = range.end - range.start;
    const idx = addInput('-ss', n(range.start), '-t', n(d), '-i', input.source);
    // tpad/apad + trim pin both streams to exactly d, so a segment whose audio
    // runs a frame short (common at MediaRecorder cluster edges) cannot drift
    // the concat out of sync.
    filters.push(
      `[${String(idx)}:v:0]setpts=PTS-STARTPTS,${vnorm},tpad=stop_mode=clone:stop_duration=${n(d)},trim=duration=${n(d)}[kv${String(i)}]`
    );
    if (sourceInfo.hasAudio) {
      filters.push(
        `[${String(idx)}:a:0]asetpts=PTS-STARTPTS,${AUDIO_NORM},apad,atrim=duration=${n(d)}[ka${String(i)}]`
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(d)},${AUDIO_NORM}[ka${String(i)}]`);
    }
    mainLabels.push(`[kv${String(i)}][ka${String(i)}]`);
  });

  const mainDuration = keptDuration(plan.keep);
  const mainFades = (v: string, a: string) => {
    const vf: string[] = [];
    const af: string[] = [];
    if (plan.fadeIn) {
      vf.push(`fade=t=in:st=0:d=${n(plan.fadeIn)}`);
      af.push(`afade=t=in:st=0:d=${n(plan.fadeIn)}`);
    }
    if (plan.fadeOut) {
      const st = Math.max(0, mainDuration - plan.fadeOut);
      vf.push(`fade=t=out:st=${n(st)}:d=${n(plan.fadeOut)}`);
      af.push(`afade=t=out:st=${n(st)}:d=${n(plan.fadeOut)}`);
    }
    return { vf: vf.length ? vf.join(',') : 'null', af: af.length ? af.join(',') : 'anull', v, a };
  };

  if (plan.keep.length > 1) {
    filters.push(`${mainLabels.join('')}concat=n=${String(plan.keep.length)}:v=1:a=1[mcv][mca]`);
  } else {
    filters.push('[kv0]null[mcv]', '[ka0]anull[mca]');
  }
  const mf = mainFades('mcv', 'mca');
  filters.push(`[mcv]${mf.vf}[mainv]`, `[mca]${mf.af}[maina]`);

  // --- Bumpers --------------------------------------------------------------
  const bumper = (b: Bumper, info: MediaInfo | null | undefined, tag: string): number => {
    let duration: number;
    let videoSrc: string;
    let audioSrc: string | null = null;
    if (b.kind === 'file') {
      if (!info?.hasVideo) throw new Error(`The ${tag} clip has no video`);
      if (!info.duration && !info.hasAudio)
        throw new Error(`The ${tag} clip's length is unknown; re-save it as MP4`);
      const idx = addInput('-i', b.source);
      duration = info.duration ?? 0;
      videoSrc = `[${String(idx)}:v:0]setpts=PTS-STARTPTS,${vnorm}`;
      if (info.hasAudio) audioSrc = `[${String(idx)}:a:0]asetpts=PTS-STARTPTS,${AUDIO_NORM}`;
    } else if (b.kind === 'image') {
      duration = b.duration;
      const idx = addInput('-loop', '1', '-framerate', String(fps), '-t', n(b.duration), '-i', b.source);
      videoSrc = `[${String(idx)}:v:0]${vnorm}`;
    } else {
      duration = b.duration;
      const font = input.fontFile ? `fontfile=${escapeDrawtext(input.fontFile)}` : 'font=Sans';
      const color = hexColor(b.color, '#ffffff');
      const big = Math.round(height / 12);
      const small = Math.round(height / 24);
      const title = `drawtext=${font}:expansion=none:text=${escapeDrawtext(b.text)}:fontcolor=${color}:fontsize=${String(big)}:x=(w-text_w)/2:y=(h-text_h)/2${b.subtitle ? `-${String(small)}` : ''}`;
      const sub = b.subtitle
        ? `,drawtext=${font}:expansion=none:text=${escapeDrawtext(b.subtitle)}:fontcolor=${color}@0.75:fontsize=${String(small)}:x=(w-text_w)/2:y=(h/2)+${String(Math.round(big * 0.9))}`
        : '';
      videoSrc = `color=c=${hexColor(b.background, '#0b0b10')}:s=${String(width)}x${String(height)}:r=${String(fps)}:d=${n(b.duration)},${title}${sub},format=yuv420p,setsar=1`;
    }
    const vf: string[] = [];
    const af: string[] = [];
    if (duration > 0 && !(b.kind === 'file' && !info?.duration)) {
      vf.push(`tpad=stop_mode=clone:stop_duration=${n(duration)}`, `trim=duration=${n(duration)}`);
    }
    if (b.fadeIn) {
      vf.push(`fade=t=in:st=0:d=${n(b.fadeIn)}`);
      af.push(`afade=t=in:st=0:d=${n(b.fadeIn)}`);
    }
    if (b.fadeOut && duration > 0) {
      const st = Math.max(0, duration - b.fadeOut);
      vf.push(`fade=t=out:st=${n(st)}:d=${n(b.fadeOut)}`);
      af.push(`afade=t=out:st=${n(st)}:d=${n(b.fadeOut)}`);
    }
    filters.push(`${videoSrc}${vf.length ? ',' + vf.join(',') : ''}[${tag}v]`);
    const audioBase =
      audioSrc ??
      `anullsrc=r=48000:cl=stereo,atrim=duration=${n(duration)},${AUDIO_NORM}`;
    const audioPad = audioSrc && duration > 0 ? `,apad,atrim=duration=${n(duration)}` : '';
    filters.push(`${audioBase}${audioPad}${af.length ? ',' + af.join(',') : ''}[${tag}a]`);
    return duration;
  };

  const parts: string[] = [];
  let total = mainDuration;
  if (plan.intro) {
    total += bumper(plan.intro, input.introInfo, 'intro');
    parts.push('[introv][introa]');
  }
  parts.push('[mainv][maina]');
  if (plan.outro) {
    total += bumper(plan.outro, input.outroInfo, 'outro');
    parts.push('[outrov][outroa]');
  }
  if (parts.length > 1) {
    filters.push(`${parts.join('')}concat=n=${String(parts.length)}:v=1:a=1[outv][outa]`);
  } else {
    filters.push('[mainv]null[outv]', '[maina]anull[outa]');
  }

  const preset = { fast: 'ultrafast', balanced: 'veryfast', high: 'medium' }[input.quality ?? 'balanced'];
  const codec =
    format === 'webm'
      ? [
          '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'realtime',
          '-cpu-used', input.quality === 'high' ? '4' : '8', '-row-mt', '1',
          '-c:a', 'libopus', '-b:a', '128k',
        ]
      : [
          '-c:v', 'libx264', '-preset', preset, '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
        ];

  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    ...codec,
    '-progress',
    'pipe:1',
    '-nostats',
    input.output,
  ];
  return { args, duration: total, width, height, fps };
}
