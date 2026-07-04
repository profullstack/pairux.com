import { completeStructured, type CompleteFn } from '../complete.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_MAX_TOKENS } from '../config.js';
import { buildClipPrompt, buildSummaryPrompt } from '../prompts.js';
import { clipCandidatesSchema, sessionNoteSchema, type ClipCandidate, type SessionNote } from '../schemas.js';
import type { AiProvider, SelectClipsOptions, SummarizeOptions, TranscriptInput } from '../types.js';

/**
 * Structural view of the Anthropic Messages client. `ai-core` does not depend on
 * `@anthropic-ai/sdk` directly — the desktop host injects a real `new Anthropic()`
 * (managed key or BYOK). This keeps the package light and trivially testable, and
 * makes the "only text crosses this boundary" guarantee explicit in the types.
 */
export interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
}

export interface AnthropicMessageResponse {
  readonly content: readonly AnthropicContentBlock[];
}

export interface AnthropicCreateBody {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
}

export interface AnthropicMessagesApi {
  create(body: AnthropicCreateBody): Promise<AnthropicMessageResponse>;
}

export interface AnthropicClientLike {
  readonly messages: AnthropicMessagesApi;
}

export interface AnthropicProviderOptions {
  client: AnthropicClientLike;
  /** Defaults to Haiku 4.5 — see config.ts / review finding F3. */
  model?: string;
  maxTokens?: number;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const { client } = options;

  const complete: CompleteFn = async ({ system, user }) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return response.content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('');
  };

  return {
    kind: 'anthropic',
    model,
    summarizeSession(input: TranscriptInput, summarizeOptions?: SummarizeOptions): Promise<SessionNote> {
      return completeStructured(complete, buildSummaryPrompt(input, summarizeOptions), sessionNoteSchema);
    },
    selectClips(input: TranscriptInput, selectOptions?: SelectClipsOptions): Promise<ClipCandidate[]> {
      return completeStructured(complete, buildClipPrompt(input, selectOptions), clipCandidatesSchema);
    },
  };
}
