/**
 * Structured-output schemas for AI Session Notes and AI Clips.
 *
 * These are the single source of truth for the shapes an LLM provider must
 * return. Every provider response is validated against them before it reaches
 * the rest of the app, so malformed model output can never leak downstream.
 */
import { z } from 'zod';

/** One TODO extracted from a session: what, who owns it, when, and where in the recording. */
export const actionItemSchema = z.object({
  description: z.string().min(1),
  /** Assignee display name, or null if the transcript didn't name one. */
  owner: z.string().nullable(),
  /** Deadline as stated in the session (free text), or null. */
  deadline: z.string().nullable(),
  /** Deep-link offset into the recording, in milliseconds, or null. */
  timestampMs: z.number().int().nonnegative().nullable(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

/** Structured notes produced from a session transcript. */
export const sessionNoteSchema = z.object({
  tldr: z.string().min(1),
  decisions: z.array(z.string()),
  actionItems: z.array(actionItemSchema),
  topics: z.array(z.string()),
});
export type SessionNote = z.infer<typeof sessionNoteSchema>;

/** Social destinations a clip is a good fit for. */
export const platformFitSchema = z.enum(['shorts', 'tiktok', 'reels', 'x', 'linkedin', 'youtube']);
export type PlatformFit = z.infer<typeof platformFitSchema>;

/** A single highlight candidate the model proposes for clipping. */
export const clipCandidateSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    title: z.string().min(1),
    hookCaption: z.string().min(1),
    platformFit: z.array(platformFitSchema),
  })
  .refine((clip) => clip.endMs > clip.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });
export type ClipCandidate = z.infer<typeof clipCandidateSchema>;

/** The array shape a clip-selection call must return (3–8 candidates, per the PRD). */
export const clipCandidatesSchema = z.array(clipCandidateSchema).min(1).max(8);
