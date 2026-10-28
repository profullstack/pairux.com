import type {
  CopilotNotes,
  CopilotSuggestion,
  KeyFigure,
  OpenQuestion,
  TranscriptLine,
} from '@pairux/meeting-copilot/types';
import type { UpdateOutput } from './prompts';

const MAX_QUESTIONS = 25;
const MAX_FIGURES = 60;
/** Fewer spoken words than this and the review says the transcript is too thin. */
export const THIN_WORDS = 120;

const clean = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

/** Small models fill unknown fields with words instead of "": treat those as empty. */
const PLACEHOLDERS = new Set([
  'owner',
  'the owner',
  'you',
  'unknown',
  'none',
  'n/a',
  'na',
  'tbd',
  'not specified',
  'not mentioned',
  'unspecified',
  'null',
  'undefined',
  '-',
  'none so far',
  'no answer yet',
]);
export function placeholder(value: string | undefined): string {
  // "Anthony (you)" and "You (Anthony)" are the owner by name.
  const text = clean(value)
    .replace(/^you \((.+)\)$/i, '$1')
    .replace(/\s*\(you\)$/i, '');
  return PLACEHOLDERS.has(text.toLowerCase().replace(/[.!]$/, '')) ? '' : text;
}

/** Live items are glanced at mid-call: a rambling one is dropped, never shown. */
const LIMIT = { question: 200, reason: 240, answer: 240, point: 220, figure: 60, context: 120 };
const fits = (text: string, max: number): boolean => text.length > 0 && text.length <= max;
/** One question, not a questionnaire. */
const oneQuestion = (text: string): boolean => (text.match(/\?/g) ?? []).length <= 1;
const known = (ids: Set<string>, id: string | undefined): string | undefined =>
  id && ids.has(id) ? id : undefined;

/** Fold one model update into the copilot state. Ids the model invents are dropped. */
export function mergeUpdate(
  current: {
    openQuestions: OpenQuestion[];
    figures: KeyFigure[];
    suggestions: CopilotSuggestion[];
  },
  output: UpdateOutput,
  lineIds: Set<string>,
  newId: () => string,
  now: number
): {
  notes: CopilotNotes;
  openQuestions: OpenQuestion[];
  figures: KeyFigure[];
  suggestion: CopilotSuggestion | null;
} {
  const bullet = (items: string[], max: number) =>
    items
      .map(clean)
      .filter((text) => fits(text, LIMIT.point))
      .slice(0, max);
  const notes: CopilotNotes = {
    summary: clean(output.notes.summary).slice(0, 600),
    keyPoints: bullet(output.notes.keyPoints, 12),
    decisions: bullet(output.notes.decisions, 20),
    actionItems: output.notes.actionItems
      .map((item) => ({
        text: clean(item.text),
        ...(placeholder(item.owner) ? { owner: placeholder(item.owner) } : {}),
      }))
      .filter((item) => fits(item.text, LIMIT.point))
      .slice(0, 25),
  };

  const byId = new Map(current.openQuestions.map((one) => [one.id, one]));
  const openQuestions = [...current.openQuestions];
  for (const question of output.questions) {
    const text = clean(question.text);
    const existing = question.id ? byId.get(question.id) : undefined;
    // Only an answered question carries an answer; an "answer" to an open one is invented.
    const answer =
      question.status === 'answered' ? placeholder(question.answer).slice(0, LIMIT.answer) : '';
    if (existing) {
      // The owner's own "answered" mark wins; the model may only close questions.
      if (existing.status === 'open' && question.status === 'answered') {
        existing.status = 'answered';
        if (answer) existing.answer = answer;
      }
      continue;
    }
    if (
      !fits(text, LIMIT.question) ||
      !oneQuestion(text) ||
      openQuestions.some((one) => one.text.toLowerCase() === text.toLowerCase())
    )
      continue;
    const lineId = known(lineIds, question.lineId);
    openQuestions.push({
      id: newId(),
      text,
      status: question.status,
      ...(answer ? { answer } : {}),
      ...(lineId ? { lineId } : {}),
      at: now,
    });
  }

  const figures = [...current.figures];
  for (const figure of output.figures) {
    const value = clean(figure.value);
    if (
      !fits(value, LIMIT.figure) ||
      figures.some((one) => one.value.toLowerCase() === value.toLowerCase())
    )
      continue;
    const lineId = known(lineIds, figure.lineId);
    figures.push({
      id: newId(),
      kind: figure.kind,
      value,
      context: placeholder(figure.context).slice(0, LIMIT.context),
      ...(lineId ? { lineId } : {}),
    });
  }

  let suggestion: CopilotSuggestion | null = null;
  const question = clean(output.suggestion.question);
  if (
    fits(question, LIMIT.question) &&
    oneQuestion(question) &&
    !current.suggestions.some((one) => one.question.toLowerCase() === question.toLowerCase())
  ) {
    const lineId = known(lineIds, output.suggestion.lineId);
    suggestion = {
      id: newId(),
      question,
      reason: clean(output.suggestion.reason).slice(0, LIMIT.reason),
      ...(lineId ? { lineId } : {}),
      at: now,
    };
  }

  return {
    notes,
    openQuestions: openQuestions.slice(-MAX_QUESTIONS),
    figures: figures.slice(-MAX_FIGURES),
    suggestion,
  };
}

/** Share of speaking time: the owner against everyone else, by line duration. */
export function talkListen(
  lines: TranscriptLine[],
  owner: string
): { you: number; others: number } {
  let you = 0;
  let others = 0;
  for (const line of lines) {
    const ms = Math.max(0, line.until - line.at) || line.text.split(/\s+/).length * 400;
    if (line.participant === owner) you += ms;
    else others += ms;
  }
  const total = you + others;
  if (!total) return { you: 0, others: 0 };
  const share = Math.round((you / total) * 100) / 100;
  return { you: share, others: Math.round((1 - share) * 100) / 100 };
}

export function wordCount(lines: TranscriptLine[]): number {
  return lines.reduce((sum, line) => sum + (line.text.match(/\S+/g)?.length ?? 0), 0);
}

export const isThin = (lines: TranscriptLine[]): boolean => wordCount(lines) < THIN_WORDS;

/** Lines that ended within the last `seconds` of the newest line. */
export function lastSeconds(lines: TranscriptLine[], seconds: number): TranscriptLine[] {
  const newest = lines.at(-1)?.until ?? 0;
  return lines.filter((line) => line.until >= newest - seconds * 1000);
}
