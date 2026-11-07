import type { AiProvider } from '../types.js';
import { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { createOllamaProvider, type OllamaProviderOptions } from './ollama.js';
import { createC0mputeProvider, type C0mputeProviderOptions } from './c0mpute.js';

/** Discriminated config for {@link createProvider}. */
export type AiProviderConfig =
  | ({ readonly kind: 'anthropic' } & AnthropicProviderOptions)
  | ({ readonly kind: 'ollama' } & OllamaProviderOptions)
  | ({ readonly kind: 'c0mpute' } & C0mputeProviderOptions);

/**
 * Build the configured provider. `anthropic` covers both managed keys and BYOK.
 * There is deliberately no default: transcripts are private, and which service
 * reads them (including c0mpute's peer nodes) is an explicit choice.
 */
export function createProvider(config: AiProviderConfig): AiProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'ollama':
      return createOllamaProvider(config);
    case 'c0mpute':
      return createC0mputeProvider(config);
  }
}
