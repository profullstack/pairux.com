import { z } from 'zod';
import { completeStructured, type CompleteFn } from '../complete.js';
import { DEFAULT_C0MPUTE_BASE_URL, DEFAULT_C0MPUTE_MODEL, DEFAULT_MAX_TOKENS } from '../config.js';
import { buildClipPrompt, buildSummaryPrompt } from '../prompts.js';
import {
  clipCandidatesSchema,
  sessionNoteSchema,
  type ClipCandidate,
  type SessionNote,
} from '../schemas.js';
import type {
  AiProvider,
  SelectClipsOptions,
  SummarizeOptions,
  TranscriptInput,
} from '../types.js';
import type { FetchLike } from './ollama.js';

const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export interface C0mputeProviderOptions {
  /** Infernet account key (ik_live_...). Without one, the free tier (10 calls a day). */
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}

/**
 * c0mpute: the Infernet peer network, through its OpenAI-compatible endpoint.
 *
 * OPT-IN ONLY. A session transcript is the users' own conversation, and on
 * c0mpute it is processed by third-party peer nodes. Nothing in this package
 * selects this provider by default; a caller (or a user setting) must choose
 * it explicitly with `kind: 'c0mpute'`. Peer nodes are slow under load (often
 * 60-240 s a call), so do not run it on a request path.
 */
export function createC0mputeProvider(options: C0mputeProviderOptions = {}): AiProvider {
  const model = options.model ?? DEFAULT_C0MPUTE_MODEL;
  const baseUrl = stripTrailingSlashes(options.baseUrl ?? DEFAULT_C0MPUTE_BASE_URL);
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const complete: CompleteFn = async ({ system, user }) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey) {
      headers.authorization = `Bearer ${options.apiKey}`;
    }
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`c0mpute request failed: ${String(response.status)} ${response.statusText}`);
    }
    const data = chatCompletionSchema.parse(await response.json());
    return data.choices[0]?.message.content ?? '';
  };

  return {
    kind: 'c0mpute',
    model,
    summarizeSession(
      input: TranscriptInput,
      summarizeOptions?: SummarizeOptions
    ): Promise<SessionNote> {
      return completeStructured(
        complete,
        buildSummaryPrompt(input, summarizeOptions),
        sessionNoteSchema
      );
    },
    selectClips(
      input: TranscriptInput,
      selectOptions?: SelectClipsOptions
    ): Promise<ClipCandidate[]> {
      return completeStructured(
        complete,
        buildClipPrompt(input, selectOptions),
        clipCandidatesSchema
      );
    },
  };
}
