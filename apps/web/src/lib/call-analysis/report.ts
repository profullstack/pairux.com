/**
 * The feedback report: Claude reads the transcript (with speakers and
 * timestamps), the measured delivery metrics and a handful of screen stills,
 * and returns structured coaching for the host.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import type { CallAnalysisKind } from '@pairux/shared-types';
import { formatClock, type CallMetrics, type TranscriptSegment } from './metrics';

export const REPORT_MODEL = 'claude-opus-5';

const moment = z.object({
  title: z.string(),
  detail: z.string(),
  /** Call time in ms the point refers to, when there is one. */
  atMs: z.number().nullable(),
});

export const reportSchema = z.object({
  headline: z.string(),
  overallScore: z.number(),
  summary: z.string(),
  speakers: z.array(z.object({ label: z.string(), role: z.string() })),
  strengths: z.array(moment),
  improvements: z.array(moment.extend({ suggestion: z.string() })),
  delivery: z.object({
    pace: z.string(),
    clarity: z.string(),
    confidence: z.string(),
    fillerWords: z.string(),
    listening: z.string(),
  }),
  visuals: z
    .object({
      summary: z.string(),
      suggestions: z.array(z.string()),
    })
    .nullable(),
  focus: z.object({ title: z.string(), points: z.array(moment) }),
  keyMoments: z.array(z.object({ atMs: z.number(), label: z.string() })),
  actionItems: z.array(z.object({ task: z.string(), owner: z.string().nullable() })),
  practiceNext: z.array(z.string()),
});

export type CallReport = z.infer<typeof reportSchema>;

const KIND_GUIDE: Record<CallAnalysisKind, { label: string; focus: string }> = {
  general: {
    label: 'call',
    focus:
      'Focus title: "How the call went". Cover whether the call reached its goal, how well people were heard, and what would have made it shorter or clearer.',
  },
  interview: {
    label: 'interview',
    focus:
      'Focus title: "Question by question". For each substantial question asked, one point: what was asked, how the answer landed (structure, specifics, examples, length), and a stronger way to answer it. If the host was the interviewer rather than the candidate, assess their questions and how they listened instead.',
  },
  'team-sync': {
    label: 'team sync',
    focus:
      'Focus title: "Decisions and follow-through". List the decisions reached, the open questions left hanging, and where the meeting drifted. Fill actionItems with every commitment made, with its owner when one was named.',
  },
  presentation: {
    label: 'presentation',
    focus:
      'Focus title: "Structure and story". Assess the opening, the through-line, the transitions, and the close; note where the audience was likely lost and how questions were handled. Use the screen stills to judge the slides or demo: density, legibility, and whether what was on screen matched what was being said.',
  },
};

function systemPrompt(kind: CallAnalysisKind): string {
  const guide = KIND_GUIDE[kind];
  return `You are a candid, specific communication coach. The host of a ${guide.label} held over PairUX (a screen-sharing and call app) asked for feedback on how it went, so they can do better next time.

Write for the host. Be direct and concrete: every strength and improvement cites what actually happened, with the call time (atMs) where it applies. Prefer three sharp points over eight vague ones. Do not pad, do not flatter, and do not invent anything that is not in the transcript, metrics or stills.

The metrics were measured from the transcript and are accurate; use them as evidence (for example "you spoke 71% of the time"), and do not recompute them. Speaker labels come from automatic diarization and can be imperfect: in "speakers", say which label is most likely the host and what each other speaker's role seems to be.

overallScore is 1 to 10, where 5 is an ordinary ${guide.label} and 8 or more is genuinely strong. ${guide.focus}

Set visuals to null when there are no screen stills. keyMoments marks the 3 to 8 moments worth replaying. practiceNext is the top three things to practice before the next ${guide.label}, each one sentence.`;
}

function transcriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatClock(s.startMs)}${s.speaker ? ` ${s.speaker}` : ''}] ${s.text}`)
    .join('\n');
}

function metricsText(metrics: CallMetrics): string {
  const lines = [
    `Duration: ${formatClock(metrics.durationMs)}; nobody speaking ${String(metrics.silenceShare)}% of the time.`,
    ...metrics.speakers.map(
      (s) =>
        `${s.speaker}: ${String(s.talkShare)}% of talk time, ${String(s.words)} words at ${String(s.wordsPerMinute)} wpm, ` +
        `${String(s.fillerWords)} filler words (${String(s.fillerRate)} per 100 words), ${String(s.questions)} questions, ` +
        `${String(s.turns)} turns, longest turn ${formatClock(s.longestTurnMs)}, cut in ${String(s.interruptions)} times.`
    ),
  ];
  if (metrics.topFillers.length > 0) {
    lines.push(
      `Most used fillers: ${metrics.topFillers.map((f) => `"${f.word}" x${String(f.count)}`).join(', ')}.`
    );
  }
  return lines.join('\n');
}

export interface ReportInput {
  kind: CallAnalysisKind;
  title: string | null;
  hostName: string | null;
  source: 'web' | 'desktop' | 'mobile';
  segments: TranscriptSegment[];
  metrics: CallMetrics;
  /** JPEG stills with their call time, already down-selected. */
  frames: { atMs: number; jpeg: Buffer }[];
}

export class ReportRefusedError extends Error {}

/**
 * Every provider tried was out of budget or rate limited. Not the recording's
 * fault: the job waits and tries again later without using up an attempt.
 */
export class ReportQuotaError extends Error {}

/** A provider-side failure worth trying the next provider for. */
class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly quota: boolean
  ) {
    super(message);
  }
}

export type ReportProvider = 'anthropic' | 'openai';

export const OPENAI_REPORT_MODEL = 'gpt-5.4';

export interface WrittenReport {
  report: CallReport;
  /** Which model wrote it, e.g. "claude-opus-5" or "gpt-5.4". */
  model: string;
}

function contextText(input: ReportInput): string {
  const context = [
    input.title ? `Call title: ${input.title}` : null,
    input.hostName ? `Host: ${input.hostName}` : null,
    input.source === 'mobile'
      ? 'Captured on the host’s phone: only the host’s own microphone was recorded, so other speakers may be missing or faint.'
      : 'Captured by the host’s app: the audio includes every participant.',
  ]
    .filter(Boolean)
    .join('\n');
  return `${context}\n\n<metrics>\n${metricsText(input.metrics)}\n</metrics>\n\n<transcript>\n${transcriptText(input.segments)}\n</transcript>\n\nWrite the feedback report.`;
}

function finish(parsed: CallReport): CallReport {
  return { ...parsed, overallScore: Math.min(10, Math.max(1, Math.round(parsed.overallScore))) };
}

const QUOTA_TEXT = /usage limit|credit balance|insufficient_quota|quota|billing/i;

export async function writeReportWithAnthropic(
  input: ReportInput,
  client = new Anthropic()
): Promise<WrittenReport> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const frame of input.frames) {
    content.push({ type: 'text', text: `Screen at ${formatClock(frame.atMs)}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.jpeg.toString('base64') },
    });
  }
  content.push({ type: 'text', text: contextText(input) });

  let response;
  try {
    response = await client.beta.messages.parse({
      model: REPORT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system: systemPrompt(input.kind),
      messages: [{ role: 'user', content }],
      output_config: { format: betaZodOutputFormat(reportSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new ProviderUnavailableError(`Anthropic: ${error.message}`, true);
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      throw new ProviderUnavailableError(`Anthropic: ${error.message}`, false);
    }
    if (error instanceof Anthropic.BadRequestError && QUOTA_TEXT.test(error.message)) {
      throw new ProviderUnavailableError(`Anthropic: ${error.message}`, true);
    }
    if (
      error instanceof Anthropic.InternalServerError ||
      error instanceof Anthropic.APIConnectionError
    ) {
      throw new ProviderUnavailableError(`Anthropic: ${error.message}`, false);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    throw new ReportRefusedError('The model declined to write this report');
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Report was not valid JSON (stop: ${String(response.stop_reason)})`);
  return { report: finish(parsed), model: response.model };
}

/**
 * JSON Schema for OpenAI strict structured outputs: every property required
 * and no extra keys, which is what `strict: true` demands.
 */
export function strictJsonSchema(): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema') continue;
      out[key] = walk(value);
    }
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      out.required = Object.keys(out.properties);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(z.toJSONSchema(reportSchema)) as Record<string, unknown>;
}

export async function writeReportWithOpenAI(
  input: ReportInput,
  opts: { apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {}
): Promise<WrittenReport> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey)
    throw new ProviderUnavailableError('OpenAI: OPENAI_API_KEY is not configured', false);
  const model = opts.model ?? process.env.OPENAI_REPORT_MODEL ?? OPENAI_REPORT_MODEL;

  const content: Record<string, unknown>[] = [];
  for (const frame of input.frames) {
    content.push({ type: 'text', text: `Screen at ${formatClock(frame.atMs)}:` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}` },
    });
  }
  content.push({ type: 'text', text: contextText(input) });

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: systemPrompt(input.kind) },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'call_report', strict: true, schema: strictJsonSchema() },
        },
      }),
    });
  } catch (error) {
    throw new ProviderUnavailableError(`OpenAI: ${String(error)}`, false);
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; type?: string };
    model?: string;
    choices?: {
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }[];
  };
  if (!res.ok) {
    const message = `OpenAI ${String(res.status)}: ${body.error?.message ?? 'request failed'}`;
    const quota =
      res.status === 429 ||
      QUOTA_TEXT.test(`${body.error?.code ?? ''} ${body.error?.message ?? ''}`);
    if (quota || res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new ProviderUnavailableError(message, quota);
    }
    throw new Error(message);
  }
  const choice = body.choices?.[0];
  if (choice?.message?.refusal)
    throw new ReportRefusedError('The model declined to write this report');
  const text = choice?.message?.content;
  if (!text)
    throw new Error(`OpenAI returned no report (finish: ${String(choice?.finish_reason)})`);
  const parsed = reportSchema.parse(JSON.parse(text));
  return { report: finish(parsed), model: body.model ?? model };
}

/** Provider order from REPORT_PROVIDERS ("anthropic,openai" by default). */
export function reportProviders(
  env: Record<string, string | undefined> = process.env
): ReportProvider[] {
  const listed = (env.REPORT_PROVIDERS ?? 'anthropic,openai')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is ReportProvider => p === 'anthropic' || p === 'openai');
  return listed.length > 0 ? [...new Set(listed)] : ['anthropic', 'openai'];
}

/**
 * Write the report with the first provider that can: Claude, then OpenAI by
 * default. A provider that is out of budget, rate limited, unauthorised or
 * down hands over to the next; any other failure (bad output, refusal) stops
 * here. If a provider was out of budget and none could write it, ReportQuotaError tells the job
 * to wait rather than burn an attempt.
 */
export async function writeReport(
  input: ReportInput,
  deps: {
    providers?: ReportProvider[];
    anthropic?: (input: ReportInput) => Promise<WrittenReport>;
    openai?: (input: ReportInput) => Promise<WrittenReport>;
  } = {}
): Promise<WrittenReport> {
  const run: Record<ReportProvider, (input: ReportInput) => Promise<WrittenReport>> = {
    anthropic: deps.anthropic ?? ((i) => writeReportWithAnthropic(i)),
    openai: deps.openai ?? ((i) => writeReportWithOpenAI(i)),
  };
  const failures: ProviderUnavailableError[] = [];
  for (const provider of deps.providers ?? reportProviders()) {
    try {
      return await run[provider](input);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      console.warn(
        `[call-analysis] ${provider} unavailable, trying the next provider:`,
        error.message
      );
      failures.push(error);
    }
  }
  const summary = failures.map((f) => f.message).join(' | ');
  // Out of budget somewhere and nothing else worked: wait it out rather than fail.
  if (failures.some((f) => f.quota)) throw new ReportQuotaError(summary);
  throw new Error(`No report provider could write the report: ${summary}`);
}

/** Evenly spaced pick of at most `max` items, always keeping the first and last. */
export function pickEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    const item = items[Math.round((i * (items.length - 1)) / (max - 1))];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}
