import { DEFAULT_MAX_CLIPS } from './config.js';
import type { Prompt } from './complete.js';
import { getTemplate } from './templates.js';
import { formatTranscript } from './transcript.js';
import type { SelectClipsOptions, SummarizeOptions, TranscriptInput } from './types.js';

const SUMMARY_SHAPE = `{
  "tldr": string,
  "decisions": string[],
  "actionItems": [{ "description": string, "owner": string | null, "deadline": string | null, "timestampMs": number | null }],
  "topics": string[]
}`;

const CLIP_SHAPE = `[{ "startMs": number, "endMs": number, "title": string, "hookCaption": string, "platformFit": string[] }]`;

/** Build the summarization prompt: template guidance + transcript, JSON-only reply. */
export function buildSummaryPrompt(input: TranscriptInput, options?: SummarizeOptions): Prompt {
  const template = getTemplate(options?.template);
  const system = `You write structured notes from a session transcript. ${template.guidance} Reply with a single JSON object and nothing else, matching exactly this shape:\n${SUMMARY_SHAPE}`;
  const header = input.title !== undefined ? `Session: ${input.title}\n\n` : '';
  const user = `${header}Transcript:\n${formatTranscript(input)}`;
  return { system, user };
}

/** Build the clip-selection prompt: highlight instructions + optional scene changes. */
export function buildClipPrompt(input: TranscriptInput, options?: SelectClipsOptions): Prompt {
  const maxClips = options?.maxClips ?? DEFAULT_MAX_CLIPS;
  const platformLine =
    options?.platform !== undefined
      ? ` Bias selection toward content that performs well on ${options.platform}.`
      : '';
  const sceneLine =
    input.sceneChangesMs !== undefined && input.sceneChangesMs.length > 0
      ? `\n\nScene-change timestamps (ms): ${input.sceneChangesMs.join(', ')}`
      : '';
  const system = `You select the ${String(maxClips)} best short highlight moments from a session transcript for social clips.${platformLine} Each highlight must be self-contained and under 60 seconds. "platformFit" values come from: shorts, tiktok, reels, x, linkedin, youtube. Reply with a single JSON array and nothing else, matching exactly this shape:\n${CLIP_SHAPE}`;
  const user = `Transcript with timestamps:\n${formatTranscript(input)}${sceneLine}`;
  return { system, user };
}
