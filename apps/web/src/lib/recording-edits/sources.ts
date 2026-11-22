/**
 * Server-side edits run ffmpeg on our box, so a plan's intro/outro sources are
 * never trusted as given: an arbitrary URL is a server-side request forgery
 * and a path is a local file read. The only source a cloud edit may name is
 * `recording:<uuid>`, a ready recording the same user owns, which is resolved
 * here to its storage URL. Title cards need no source.
 */

import { validatePlan, EditPlanError, type Bumper, type EditPlan } from '@pairux/video-edit';
import { UUID } from './store';

export class RecordingEditError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'RecordingEditError';
  }
}

/** Resolves an owned, ready recording id to a URL ffmpeg can read, or null. */
export type OwnedSourceLookup = (recordingId: string) => Promise<string | null>;

const PREFIX = 'recording:';

async function resolveBumper(
  bumper: Bumper | null | undefined,
  label: string,
  lookup: OwnedSourceLookup
): Promise<Bumper | null> {
  if (!bumper) return null;
  if (bumper.kind === 'title') return bumper;
  const ref = bumper.source.trim();
  const id = ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : '';
  if (!UUID.test(id))
    throw new RecordingEditError(
      `${label}: a cloud edit can only use one of your recordings (recording:<id>) or a title card`
    );
  const url = await lookup(id);
  if (!url) throw new RecordingEditError(`${label}: that recording is not yours or not ready`, 404);
  return { ...bumper, source: url };
}

/**
 * Validate an untrusted plan for a cloud edit and swap its `recording:<id>`
 * sources for storage URLs. Returns both: the plan as stored (with ids, so it
 * can be shown and re-edited) and the plan to render (with URLs).
 */
export async function preparePlan(
  input: unknown,
  sourceDuration: number | null,
  lookup: OwnedSourceLookup
): Promise<{ stored: EditPlan; render: EditPlan }> {
  let stored: EditPlan;
  try {
    stored = validatePlan(input, sourceDuration);
  } catch (error) {
    if (error instanceof EditPlanError) throw new RecordingEditError(error.message);
    throw error;
  }
  const render: EditPlan = {
    ...stored,
    intro: await resolveBumper(stored.intro, 'intro', lookup),
    outro: await resolveBumper(stored.outro, 'outro', lookup),
  };
  return { stored, render };
}
