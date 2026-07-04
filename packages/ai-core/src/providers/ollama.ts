import { z } from 'zod';
import { completeStructured, type CompleteFn } from '../complete.js';
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '../config.js';
import { buildClipPrompt, buildSummaryPrompt } from '../prompts.js';
import { clipCandidatesSchema, sessionNoteSchema, type ClipCandidate, type SessionNote } from '../schemas.js';
import type { AiProvider, SelectClipsOptions, SummarizeOptions, TranscriptInput } from '../types.js';

/** Minimal response surface `ai-core` needs from a fetch implementation. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}

/** Injectable fetch, so the fully-local Ollama path is testable without a network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

const ollamaChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
});

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (url, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

/** Fully-local provider (nothing leaves the device) backed by an Ollama server. */
export function createOllamaProvider(options: OllamaProviderOptions = {}): AiProvider {
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  const complete: CompleteFn = async ({ system, user }) => {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${String(response.status)} ${response.statusText}`);
    }
    const data = ollamaChatResponseSchema.parse(await response.json());
    return data.message.content;
  };

  return {
    kind: 'ollama',
    model,
    summarizeSession(input: TranscriptInput, summarizeOptions?: SummarizeOptions): Promise<SessionNote> {
      return completeStructured(complete, buildSummaryPrompt(input, summarizeOptions), sessionNoteSchema);
    },
    selectClips(input: TranscriptInput, selectOptions?: SelectClipsOptions): Promise<ClipCandidate[]> {
      return completeStructured(complete, buildClipPrompt(input, selectOptions), clipCandidatesSchema);
    },
  };
}
