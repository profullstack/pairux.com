/**
 * @pairux/ai-core — provider abstraction for PairUX Pro AI Session Notes + Clips.
 *
 * One interface ({@link AiProvider}), two drivers (Anthropic for managed/BYOK,
 * Ollama for fully-local), Zod-validated structured output, and a one-shot
 * auto-repair on malformed replies. Only transcript text ever crosses a provider
 * boundary.
 */
export * from './types.js';
export * from './schemas.js';
export * from './templates.js';
export * from './config.js';
export * from './errors.js';
export * from './parse.js';
export * from './transcript.js';
export * from './complete.js';
export * from './prompts.js';
export * from './providers/anthropic.js';
export * from './providers/ollama.js';
export * from './providers/factory.js';
