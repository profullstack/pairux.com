import type { ClipCandidate, PlatformFit, SessionNote } from './schemas.js';
import type { SessionTemplateId } from './templates.js';

/** One attributed line of transcript. Track-level speaker labels ("Host", "Viewer-1"). */
export interface TranscriptSegment {
  /** Millisecond offset from session start. */
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
}

/**
 * The only thing ever handed to a provider.
 *
 * By construction this carries transcript TEXT and lightweight metadata only —
 * never audio or video. That is the boundary that keeps the "media never leaves
 * the device" promise intact even in managed-key mode.
 */
export interface TranscriptInput {
  segments: TranscriptSegment[];
  /** Optional scene-change offsets (ms) from a cheap ffmpeg pass, used to bias clip selection. */
  sceneChangesMs?: number[];
  /** Human-readable session title/context. */
  title?: string;
  /** Total session duration in ms, if known. */
  durationMs?: number;
}

export type ProviderKind = 'anthropic' | 'ollama';

export interface SummarizeOptions {
  template?: SessionTemplateId;
}

export interface SelectClipsOptions {
  /** Bias selection toward a target social platform. */
  platform?: PlatformFit;
  /** Cap the number of candidates requested (clamped to the schema's 1–8 range). */
  maxClips?: number;
}

/** A configured provider. Both methods send transcript text only and return validated output. */
export interface AiProvider {
  readonly kind: ProviderKind;
  readonly model: string;
  summarizeSession(input: TranscriptInput, options?: SummarizeOptions): Promise<SessionNote>;
  selectClips(input: TranscriptInput, options?: SelectClipsOptions): Promise<ClipCandidate[]>;
}
