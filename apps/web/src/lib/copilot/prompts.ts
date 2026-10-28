import { z } from 'zod/v4';
import { roleDef } from '@pairux/meeting-copilot/roles';
import {
  FIGURE_KINDS,
  type CopilotNotes,
  type CopilotRole,
  type KeyFigure,
  type OpenQuestion,
  type TranscriptLine,
} from '@pairux/meeting-copilot/types';

// Schemas stay flat and use '' for "none": small self-hosted models follow
// them as reliably as Claude does, and every provider gets the same shape.

const actionItem = z.object({
  text: z.string(),
  owner: z.string().describe('Who will do it, or "" when nobody was named.'),
});

export const updateSchema = z.object({
  notes: z.object({
    summary: z.string().describe('Two or three sentences: what this meeting is about so far.'),
    keyPoints: z.array(z.string()).describe('At most 6 bullet points of a few words each.'),
    decisions: z.array(z.string()).describe('Only things that were actually decided.'),
    actionItems: z.array(actionItem).describe('Only things someone committed to do.'),
  }),
  questions: z
    .array(
      z.object({
        id: z.string().describe('The id of an existing open question, or "" for a new one.'),
        text: z.string(),
        status: z.enum(['open', 'answered']),
        answer: z.string().describe('The answer as said, or "".'),
        lineId: z.string().describe('The transcript line id it comes from, or "".'),
      })
    )
    .describe('Every open question, updated. Mark one answered only when the answer was said.'),
  figures: z
    .array(
      z.object({
        kind: z.enum(FIGURE_KINDS),
        value: z.string().describe('Exactly as said: "$40k", "March 3", "Priya".'),
        context: z.string().describe('What it refers to, a few words.'),
        lineId: z.string(),
      })
    )
    .describe('NEW numbers, money, dates, names and commitments from the new lines only.'),
  suggestion: z.object({
    question: z
      .string()
      .describe(
        'ONE short question the owner should ask next, or "" when nothing is worth asking now.'
      ),
    reason: z.string().describe('Why, in one short sentence (the gap or vague answer).'),
    lineId: z.string().describe('The line that prompted it, or "".'),
  }),
});
export type UpdateOutput = z.infer<typeof updateSchema>;

export const askSchema = z.object({ answer: z.string() });
export const recapSchema = z.object({ recap: z.string() });
export const followUpsSchema = z.object({
  actionItems: z.array(
    z.object({ text: z.string(), owner: z.string(), due: z.string().describe('As said, or "".') })
  ),
  message: z
    .string()
    .describe('A short recap message the owner can send: thanks, what was agreed, next steps.'),
});
export const reviewSchema = z.object({
  focusArea: z.string().describe('The one thing the owner should work on next time.'),
  feedback: z.array(z.string()).describe('Two to four plain-language observations with examples.'),
  followUpClarity: z.enum(['clear', 'partial', 'unclear']),
  note: z.string().describe('Anything you could not judge from this transcript, or "".'),
});

const HONESTY =
  'Use only what is in the transcript and notes. Never invent names, numbers, dates, answers or commitments. ' +
  'When the transcript does not say, say so plainly instead of guessing; leave unknown fields as "". ' +
  'Write in the language the meeting is held in.';

/** Live output is glanced at mid-call, and small self-hosted models ramble without this. */
const TERSE =
  'Be terse: every bullet and question is one short sentence (under 20 words). ' +
  'A suggested question is ONE question, never a list. Capture every date, number and name said in the new lines as a figure.';

export function systemPrompt(role: CopilotRole, task: string): string {
  const def = roleDef(role);
  return [
    'You are PairUX Copilot, an AI assistant sitting in a live video meeting for one participant (the owner, marked "(you)").',
    `Owner's role: ${def.label}. ${def.focus}`,
    `Listen for: ${def.listensFor.join('; ')}.`,
    task,
    HONESTY,
    TERSE,
  ].join('\n');
}

export function formatLines(lines: TranscriptLine[], ownerParticipant: string): string {
  return lines
    .map(
      (line) =>
        `[${line.id}] ${line.name}${line.participant === ownerParticipant ? ' (you)' : ''}: ${line.text}`
    )
    .join('\n');
}

/** Keep a prompt's transcript under `maxChars`, dropping the oldest lines. */
export function clipLines(lines: TranscriptLine[], maxChars: number): TranscriptLine[] {
  const kept: TranscriptLine[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line) continue;
    size += line.text.length + line.name.length + 16;
    if (size > maxChars) break;
    kept.unshift(line);
  }
  return kept;
}

export function updatePrompt(input: {
  notes: CopilotNotes;
  openQuestions: OpenQuestion[];
  figures: KeyFigure[];
  recentSuggestions: string[];
  context: TranscriptLine[];
  fresh: TranscriptLine[];
  owner: string;
}): string {
  return [
    'Current notes. Rewrite them to cover everything said so far, including the new lines: always a summary and the key points; decisions and action items only when they were actually made:',
    JSON.stringify(input.notes),
    'Open questions so far (keep their ids):',
    JSON.stringify(
      input.openQuestions.map(({ id, text, status, answer }) => ({
        id,
        text,
        status,
        answer: answer ?? '',
      }))
    ),
    `Figures already captured: ${input.figures.map((one) => one.value).join(', ') || 'none'}`,
    `Questions you already suggested (do not repeat them): ${input.recentSuggestions.join(' | ') || 'none'}`,
    'Earlier lines, for context:',
    formatLines(input.context, input.owner) || '(none)',
    'NEW lines since your last update:',
    formatLines(input.fresh, input.owner),
    'Suggest a question only when there is a real gap or a vague answer worth probing; otherwise leave it empty.',
  ].join('\n\n');
}
