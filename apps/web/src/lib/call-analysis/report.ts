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

export async function writeReport(
  input: ReportInput,
  client = new Anthropic()
): Promise<CallReport> {
  const context = [
    input.title ? `Call title: ${input.title}` : null,
    input.hostName ? `Host: ${input.hostName}` : null,
    input.source === 'mobile'
      ? 'Captured on the host’s phone: only the host’s own microphone was recorded, so other speakers may be missing or faint.'
      : 'Captured by the host’s app: the audio includes every participant.',
  ]
    .filter(Boolean)
    .join('\n');

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const frame of input.frames) {
    content.push({ type: 'text', text: `Screen at ${formatClock(frame.atMs)}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.jpeg.toString('base64') },
    });
  }
  content.push({
    type: 'text',
    text: `${context}\n\n<metrics>\n${metricsText(input.metrics)}\n</metrics>\n\n<transcript>\n${transcriptText(input.segments)}\n</transcript>\n\nWrite the feedback report.`,
  });

  const response = await client.beta.messages.parse({
    model: REPORT_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    system: systemPrompt(input.kind),
    messages: [{ role: 'user', content }],
    output_config: { format: betaZodOutputFormat(reportSchema) },
  });

  if (response.stop_reason === 'refusal') {
    throw new ReportRefusedError('The model declined to write this report');
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Report was not valid JSON (stop: ${String(response.stop_reason)})`);
  return { ...parsed, overallScore: Math.min(10, Math.max(1, Math.round(parsed.overallScore))) };
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
