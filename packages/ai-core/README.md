# @pairux/ai-core

Provider abstraction for PairUX Pro **AI Session Notes** and **AI Clips**. This is the
compute-plane contract the desktop host calls into: transcript text in, validated
structured output out.

## What it does

- **One interface** — `AiProvider` with `summarizeSession()` and `selectClips()`.
- **Two drivers** — `anthropic` (managed key **or** BYOK) and `ollama` (fully local).
- **Validated output** — every reply is parsed against Zod schemas (`SessionNote`,
  `ClipCandidate[]`). Malformed output triggers exactly one auto-repair retry, then
  throws `StructuredOutputError` so the caller can fall back to manual mode — the
  contract the PRD specifies for clip selection.
- **Text-only boundary** — a provider only ever receives `TranscriptInput` (text +
  metadata). Audio and video never cross this package, by construction.

## Usage

```ts
import Anthropic from '@anthropic-ai/sdk';
import { createProvider } from '@pairux/ai-core';

// Managed key or BYOK — the host injects the real SDK client.
const provider = createProvider({ kind: 'anthropic', client: new Anthropic() });

const note = await provider.summarizeSession(transcript, { template: 'pair-programming' });
const clips = await provider.selectClips(transcript, { platform: 'shorts', maxClips: 5 });
```

Fully-local mode (nothing leaves the device):

```ts
const provider = createProvider({ kind: 'ollama', model: 'llama3.1' });
```

## Notes

- The managed default model is **Haiku 4.5** — see `config.ts`. This keeps the
  summarize + clip-select pair (two transcript-text-only calls per session) inside
  the Pro unit-economics envelope; BYOK callers can override for higher quality.
- `ai-core` deliberately does **not** depend on `@anthropic-ai/sdk`. The host passes a
  client that structurally matches `AnthropicClientLike`, keeping this package light
  and unit-testable offline.

## Scope

This is the foundation slice for the "Replay" PRD. Recording (P0-1), local Whisper
transcription (P0-2), and the ffmpeg clip renderer (P0-4) live in the desktop app and
depend on this contract; they are not part of this package.
