/**
 * Node-only runners: spawn ffmpeg and c0mpute. Imported as
 * `@pairux/video-edit/node` so browser bundles (the web editor) never pull in
 * child_process.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  c0mputeCandidates,
  c0mputeLinkArgs,
  c0mputePutArgs,
  parseLinkOutput,
  parsePutOutput,
  type C0mputePublishResult,
} from './c0mpute.js';
import { compileEdit, type CompileInput } from './ffmpeg.js';
import type { EditPlan } from './plan.js';
import { parseProbe, probeArgs, remuxArgs, type MediaInfo } from './probe.js';
import { createProgressParser, type ProgressUpdate } from './progress.js';

export class RenderCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'RenderCancelled';
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  bin: string,
  args: string[],
  opts: {
    signal?: AbortSignal | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    onStdout?: ((s: string) => void) | undefined;
    onStderr?: ((s: string) => void) | undefined;
    keepStderr?: number | undefined;
  } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new RenderCancelled());
      return;
    }
    const child = spawn(bin, args, { env: opts.env ?? process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const keep = opts.keepStderr ?? 64 * 1024;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => {
      if (stdout.length < 1024 * 1024) stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on('data', (s: string) => {
      stderr = (stderr + s).slice(-keep);
      opts.onStderr?.(s);
    });
    const onAbort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) reject(new RenderCancelled());
      else resolve({ code, stdout, stderr });
    });
  });
}

export async function probeMedia(ffmpeg: string, source: string): Promise<MediaInfo> {
  // ffmpeg exits 1 here ("At least one output file must be specified"); the
  // banner on stderr is what we want.
  const { stderr } = await run(ffmpeg, probeArgs(source));
  if (/No such file|Invalid data found|Permission denied|Server returned 4/.test(stderr))
    throw new Error(`Cannot read ${source}: ${lastLine(stderr)}`);
  return parseProbe(stderr);
}

/** Stream-copy a file so it has a duration and seek index. */
export async function remux(ffmpeg: string, source: string, output: string): Promise<void> {
  const { code, stderr } = await run(ffmpeg, remuxArgs(source, output));
  if (code !== 0) throw new Error(`Remux failed: ${lastLine(stderr)}`);
}

function lastLine(s: string): string {
  return s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'unknown error';
}

export interface RenderOptions extends Omit<CompileInput, 'sourceInfo' | 'introInfo' | 'outroInfo'> {
  ffmpeg: string;
  sourceInfo?: MediaInfo | undefined;
  onProgress?: ((p: ProgressUpdate) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** Probe what is needed, compile the plan and run ffmpeg to completion. */
export async function renderEdit(
  plan: EditPlan,
  opts: RenderOptions
): Promise<{ output: string; duration: number }> {
  const sourceInfo = opts.sourceInfo ?? (await probeMedia(opts.ffmpeg, opts.source));
  const introInfo =
    plan.intro?.kind === 'file' ? await probeMedia(opts.ffmpeg, plan.intro.source) : null;
  const outroInfo =
    plan.outro?.kind === 'file' ? await probeMedia(opts.ffmpeg, plan.outro.source) : null;
  const compiled = compileEdit(plan, { ...opts, sourceInfo, introInfo, outroInfo });
  const parse = createProgressParser(compiled.duration, (p) => opts.onProgress?.(p));
  const { code, stderr } = await run(opts.ffmpeg, compiled.args, {
    signal: opts.signal,
    onStdout: parse,
  });
  if (code !== 0) throw new Error(`ffmpeg failed: ${lastLine(stderr)}`);
  opts.onProgress?.({ seconds: compiled.duration, fraction: 1, done: true });
  return { output: opts.output, duration: compiled.duration };
}

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The user's `c0mpute` binary: $C0MPUTE_BIN, then $PATH, then install spots. */
export function findC0mpute(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.C0MPUTE_BIN && executable(env.C0MPUTE_BIN)) return env.C0MPUTE_BIN;
  const exe = process.platform === 'win32' ? 'c0mpute.exe' : 'c0mpute';
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const p = join(dir, exe);
    if (executable(p)) return p;
  }
  for (const p of c0mputeCandidates(homedir(), process.platform)) if (executable(p)) return p;
  return null;
}

export interface PublishOptions {
  binary: string;
  /** Unlocks the user's c0mpute identity (C0MPUTE_DM_PASSWORD). Never stored by us. */
  password?: string | undefined;
  /** Extra readers' c0ps1… keys. */
  shareWith?: string[] | undefined;
  onLine?: ((line: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Encrypt and publish a file to c0mpute private storage, then ask for its
 * private link. The put waits until the network holds enough copies, which
 * can take minutes.
 */
export async function publishToC0mpute(
  file: string,
  opts: PublishOptions
): Promise<C0mputePublishResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.password) env.C0MPUTE_DM_PASSWORD = opts.password;
  const relay = (s: string) => {
    for (const line of s.split(/\r?\n/)) if (line.trim()) opts.onLine?.(line.trim());
  };
  const put = await run(opts.binary, c0mputePutArgs(file, opts.shareWith), {
    env,
    signal: opts.signal,
    onStderr: relay,
  });
  const ref = parsePutOutput(put.stdout);
  if (put.code !== 0 || !ref) {
    const why = lastLine(put.stderr || put.stdout);
    if (/password|passphrase|decrypt|locked/i.test(why))
      throw new Error(`c0mpute identity is locked: ${why}`);
    throw new Error(`c0mpute storage put failed: ${why}`);
  }
  const link = await run(opts.binary, c0mputeLinkArgs(ref), { env, signal: opts.signal });
  return { ref, ...parseLinkOutput(link.stdout) };
}

export type { ProgressUpdate };
