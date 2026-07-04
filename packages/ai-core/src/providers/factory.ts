import type { AiProvider } from '../types.js';
import { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { createOllamaProvider, type OllamaProviderOptions } from './ollama.js';

/** Discriminated config for {@link createProvider}. */
export type AiProviderConfig =
  | ({ readonly kind: 'anthropic' } & AnthropicProviderOptions)
  | ({ readonly kind: 'ollama' } & OllamaProviderOptions);

/** Build the configured provider. `anthropic` covers both managed keys and BYOK. */
export function createProvider(config: AiProviderConfig): AiProvider {
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'ollama':
      return createOllamaProvider(config);
  }
}
