/**
 * Provider defaults.
 *
 * The managed-key default is deliberately Haiku 4.5. Summarize + clip-select is
 * ~2 transcript-text-only calls per session; at Haiku pricing that keeps the
 * managed path inside the Pro unit-economics envelope (review finding F3 — the
 * "<$0.40/user/mo" guardrail is only reachable at Haiku tier). BYOK callers can
 * override `model` with any Anthropic model for higher-quality summaries.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
/** Infernet's OpenAI-compatible endpoint for c0mpute (opt-in; see providers/c0mpute.ts). */
export const DEFAULT_C0MPUTE_BASE_URL = 'https://infernetprotocol.com/v1';
/** The Infernet house model every node pulls. */
export const DEFAULT_C0MPUTE_MODEL = 'huihui_ai/qwen3.5-abliterated:9b';
export const DEFAULT_MAX_TOKENS = 2048;
export const DEFAULT_MAX_CLIPS = 6;
