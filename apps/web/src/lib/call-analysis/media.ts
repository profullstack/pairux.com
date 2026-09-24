/**
 * ffmpeg work for call analysis: join what the host uploaded into one file,
 * measure it, and cut the audio into pieces small enough to transcribe.
 *
 * Runs in the web container, which installs ffmpeg (see apps/web/Dockerfile).
 */
import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Transcription pieces: 20 minutes of 24 kbps mono Opus is ~3.6 MB. */
export const SEGMENT_SECONDS = 20 * 60;

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${String(code)}: ${stderr.slice(-800)}`));
    });
  });
}

/**
 * Standalone segment files (mobile) become one file via the concat demuxer.
 * Stream chunks (web/desktop MediaRecorder) are already one file once their
 * bytes are appended in order, so they never come through here.
 */
export async function concatSegments(files: string[], dir: string, output: string): Promise<void> {
  const list = join(dir, 'segments.txt');
  await writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    output,
  ]);
}

export interface Probe {
  durationMs: number;
  hasVideo: boolean;
}

/**
 * Duration of a recording. MediaRecorder WebM has no duration in its header,
 * so read to the end: decode the audio to null and take the last timestamp.
 */
export async function probe(input: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'csv=p=0',
    input,
  ]);
  const hasVideo = stdout.split('\n').some((l) => l.trim() === 'video');
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', input, '-vn', '-f', 'null', '-']);
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times[times.length - 1];
  const durationMs = last
    ? Math.round((Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) * 1000)
    : 0;
  return { durationMs, hasVideo };
}

/** Mono 16 kHz Opus pieces of SEGMENT_SECONDS, in order: [path, offsetMs][]. */
export async function extractAudioSegments(
  input: string,
  dir: string
): Promise<{ path: string; offsetMs: number }[]> {
  await run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    '-f',
    'segment',
    '-segment_time',
    String(SEGMENT_SECONDS),
    '-reset_timestamps',
    '1',
    join(dir, 'audio-%03d.ogg'),
  ]);
  const names = (await readdir(dir)).filter((n) => /^audio-\d{3}\.ogg$/.test(n)).sort();
  return names.map((name, i) => ({ path: join(dir, name), offsetMs: i * SEGMENT_SECONDS * 1000 }));
}
