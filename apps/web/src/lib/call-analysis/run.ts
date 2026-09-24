/**
 * The report job: turn one finished capture into a feedback report.
 *
 * download chunks -> one recording -> audio pieces -> diarized transcript ->
 * metrics -> Claude report -> keep or delete the recording -> email the host.
 *
 * Driven once a minute by pg_cron through POST /api/analyses/run, which claims
 * at most one analysis at a time (claim_call_analysis). A failure is retried on
 * later runs, up to 3 attempts, before the analysis is marked failed.
 */
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmailer } from '@profullstack/emailer';
import {
  ANALYSIS_BUCKET,
  deleteAnalysisFiles,
  frameTimeMs,
  groupChunksByRun,
  recordingPathFor,
  type AnalysisRow,
  type Db,
} from './store';
import { concatSegments, extractAudioSegments, probe } from './media';
import { transcribeAll } from './transcribe';
import { computeMetrics } from './metrics';
import {
  pickEvenly,
  writeReport,
  ReportQuotaError,
  ReportRefusedError,
  type CallReport,
} from './report';

const MAX_FRAMES_IN_REPORT = 12;
const MAX_ATTEMPTS = 3;
/** How long to wait before retrying when every report provider is out of budget. */
export const QUOTA_RETRY_MS = 30 * 60 * 1000;

/** A problem with the recording itself: retrying cannot help. */
class NothingToAnalyseError extends Error {}

export function extensionFor(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.endsWith('/webm')) return 'webm';
  if (base.endsWith('/ogg')) return 'ogg';
  if (
    base === 'audio/mp4' ||
    base === 'audio/m4a' ||
    base === 'audio/x-m4a' ||
    base === 'audio/aac'
  )
    return 'm4a';
  if (base.endsWith('/mp4')) return 'mp4';
  return 'bin';
}

async function listNames(db: Db, folder: string): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage
      .from(ANALYSIS_BUCKET)
      .list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list ${folder}: ${error.message}`);
    names.push(...data.map((f) => f.name));
    if (data.length < 1000) break;
  }
  return names.sort();
}

async function download(db: Db, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(ANALYSIS_BUCKET).download(path);
  if (error) throw new Error(`Could not download ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Join the uploaded chunks into one local recording file. Chunks of one
 * recorder run are appended byte-for-byte (MediaRecorder timeslices of one
 * recording form one file); separate runs (a host who reloaded mid-call, or
 * mobile's rotating segments) are then joined in order by ffmpeg.
 */
async function assemble(db: Db, row: AnalysisRow, dir: string): Promise<string> {
  const runs = groupChunksByRun(await listNames(db, `${row.id}/chunks`));
  if (runs.length === 0) throw new NothingToAnalyseError('No audio was captured during this call');
  const ext = extensionFor(row.mime_type);

  const runFiles: string[] = [];
  for (const [i, chunks] of runs.entries()) {
    const file = join(dir, `run-${String(i).padStart(4, '0')}.${ext}`);
    await writeFile(file, Buffer.alloc(0));
    for (const name of chunks) {
      await appendFile(file, await download(db, `${row.id}/chunks/${name}`));
    }
    runFiles.push(file);
  }
  const [only] = runFiles;
  if (runFiles.length === 1 && only) return only;

  const output = join(dir, `recording.${ext}`);
  await concatSegments(runFiles, dir, output);
  return output;
}

async function hostName(db: Db, userId: string): Promise<string | null> {
  const { data } = (await db
    .from('profiles')
    .select('display_name, username')
    .eq('id', userId)
    .maybeSingle()) as { data: { display_name: string | null; username: string | null } | null };
  return data?.display_name ?? data?.username ?? null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://pairux.com';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

async function emailHost(db: Db, row: AnalysisRow, report: CallReport | null, failed?: string) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return;
  const { data } = await db.auth.admin.getUserById(row.host_user_id);
  const to = data.user?.email;
  if (!to) return;
  const url = `${appUrl()}/analyses/${row.id}`;
  const title = row.title ?? 'your call';
  const emailer = createEmailer({
    resendApiKey,
    defaultFrom: process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>',
  }) as { send: (o: unknown) => Promise<unknown> };
  await emailer.send({
    to,
    subject: report
      ? `Your call analysis is ready: ${report.headline}`
      : 'Your call analysis could not be finished',
    html: report
      ? `<p>The AI analysis of <strong>${escapeHtml(title)}</strong> is ready.</p>
<p><strong>${escapeHtml(report.headline)}</strong> (${String(report.overallScore)}/10)</p>
<p>${escapeHtml(report.summary)}</p>
<p><a href="${url}">Read the full report</a></p>`
      : `<p>We could not finish the AI analysis of <strong>${escapeHtml(title)}</strong>: ${escapeHtml(failed ?? 'unknown error')}.</p>
<p><a href="${url}">See details</a></p>`,
  });
}

export async function processAnalysis(
  db: Db,
  row: AnalysisRow,
  deps: { openaiKey?: string; report?: typeof writeReport } = {}
): Promise<'ready' | 'retry' | 'failed'> {
  const dir = await mkdtemp(join(tmpdir(), `analysis-${row.id}-`));
  try {
    const openaiKey = deps.openaiKey ?? process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured');

    const recording = await assemble(db, row, dir);
    const { durationMs } = await probe(recording);
    if (durationMs < 5_000) throw new NothingToAnalyseError('The call was too short to analyse');

    const audioDir = join(dir, 'audio');
    await mkdir(audioDir);
    const pieces = await extractAudioSegments(recording, audioDir);
    const segments = await transcribeAll(pieces, { apiKey: openaiKey });
    if (segments.length === 0)
      throw new NothingToAnalyseError('No speech was detected in the recording');

    const metrics = computeMetrics(segments, durationMs);

    const frameNames = pickEvenly(await listNames(db, `${row.id}/frames`), MAX_FRAMES_IN_REPORT);
    const frames = [];
    for (const name of frameNames) {
      frames.push({
        atMs: frameTimeMs(name),
        jpeg: await download(db, `${row.id}/frames/${name}`),
      });
    }

    const written = await (deps.report ?? writeReport)({
      kind: row.kind,
      title: row.title,
      hostName: await hostName(db, row.host_user_id),
      source: row.source,
      segments,
      metrics,
      frames,
    });
    const report: CallReport & { generatedBy: string } = {
      ...written.report,
      generatedBy: written.model,
    };

    let recordingPath: string | null = null;
    if (row.keep_recording) {
      recordingPath = recordingPathFor(row.id, extensionFor(row.mime_type));
      const { error } = await db.storage
        .from(ANALYSIS_BUCKET)
        .upload(recordingPath, await readFile(recording), {
          contentType: row.mime_type.split(';')[0] ?? 'application/octet-stream',
          upsert: true,
        });
      if (error) throw new Error(`Could not save the recording: ${error.message}`);
    }

    await db
      .from('call_analyses')
      .update({
        status: 'ready',
        transcript: segments,
        metrics,
        report,
        duration_seconds: Math.round(durationMs / 1000),
        recording_path: recordingPath,
        error: null,
        completed_at: new Date().toISOString(),
      } as never)
      .eq('id', row.id);

    await deleteAnalysisFiles(db, row.id, recordingPath ? [recordingPath] : []);
    await emailHost(db, row, report).catch((e: unknown) => {
      console.error('[call-analysis] email failed:', e);
    });
    return 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ReportQuotaError) {
      // Out of AI budget is not the recording's fault: keep everything, give
      // the attempt back, and try again later (claim skips it until then).
      console.warn(`[call-analysis] ${row.id} waiting for report budget:`, message);
      await db
        .from('call_analyses')
        .update({
          status: 'queued',
          attempts: Math.max(0, row.attempts - 1),
          error: `Waiting: the AI providers are out of budget (${message})`,
          queued_at: new Date(Date.now() + QUOTA_RETRY_MS).toISOString(),
        } as never)
        .eq('id', row.id);
      return 'retry';
    }
    const permanent =
      error instanceof NothingToAnalyseError ||
      error instanceof ReportRefusedError ||
      row.attempts >= MAX_ATTEMPTS;
    console.error(`[call-analysis] ${row.id} failed (attempt ${String(row.attempts)}):`, message);
    await db
      .from('call_analyses')
      .update(
        (permanent
          ? { status: 'failed', error: message, completed_at: new Date().toISOString() }
          : { status: 'queued', error: message, queued_at: new Date().toISOString() }) as never
      )
      .eq('id', row.id);
    if (permanent) {
      await deleteAnalysisFiles(db, row.id).catch(() => undefined);
      await emailHost(db, row, null, message).catch(() => undefined);
      return 'failed';
    }
    return 'retry';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Files left in a temp dir are a leak; exposed for tests. */
export async function tempDirsFor(id: string): Promise<string[]> {
  return (await readdir(tmpdir())).filter((n) => n.startsWith(`analysis-${id}-`));
}
