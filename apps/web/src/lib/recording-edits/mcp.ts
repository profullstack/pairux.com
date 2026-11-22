/**
 * MCP tools for recordings: list them, read one (and poll an edit), and cut a
 * new one ("keep 12:30-17:30, fade in and out, add a title card"). They need
 * no AI copilot, so the MCP route serves them even when the copilot is off.
 */

import { parseRange, type KeepRange } from '@pairux/video-edit';
import { serviceClient } from '@/lib/supabase/service';
import { RecordingEditError, createEdit } from './service';
import { getOwnedRecording, listOwnedRecordings, toView } from './store';
import { sweepStaleEdits } from './worker';

const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const RECORDING_TOOLS = [
  {
    name: 'list_recordings',
    title: 'List recordings',
    annotations: readOnly('List recordings'),
    description:
      'List your PairUX recordings and edits (newest first) with status, length and playback URL.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_recording',
    title: 'Read a recording',
    annotations: readOnly('Read a recording'),
    description:
      'One recording or edit: status, edit_progress (0-1) while rendering, edit_error, playback_url when ready.',
    inputSchema: {
      type: 'object',
      properties: { recording_id: { type: 'string', description: 'Id from list_recordings.' } },
      required: ['recording_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_recording',
    title: 'Edit a recording',
    annotations: {
      title: 'Edit a recording',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      'Cut a new recording out of one of yours: keep only the given time ranges (e.g. ["12:30-17:30"]), optionally fade in/out and add intro/outro title cards. Renders on the server; poll get_recording with the returned id.',
    inputSchema: {
      type: 'object',
      properties: {
        recording_id: { type: 'string', description: 'Recording to cut from.' },
        keep: {
          type: 'array',
          description:
            'Ranges to keep, in order: strings like "12:30-17:30" or "40m-45m", or {start, end} in seconds.',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: { start: { type: 'number' }, end: { type: 'number' } },
                required: ['start', 'end'],
              },
            ],
          },
        },
        fade_in: { type: 'number', description: 'Seconds to fade in from black (0-10).' },
        fade_out: { type: 'number', description: 'Seconds to fade out to black (0-10).' },
        intro_title: { type: 'string', description: 'Text for a 3-second intro title card.' },
        outro_title: { type: 'string', description: 'Text for a 3-second outro title card.' },
        subject: { type: 'string', description: 'Name for the new recording.' },
      },
      required: ['recording_id', 'keep'],
      additionalProperties: false,
    },
  },
] as const;

export const RECORDING_TOOL_NAMES: ReadonlySet<string> = new Set(
  RECORDING_TOOLS.map((t) => t.name)
);

export class RecordingToolError extends Error {}

function keepRanges(value: unknown): KeepRange[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new RecordingToolError('keep needs at least one range, like "12:30-17:30".');
  return value.map((one: unknown) => {
    if (typeof one === 'string') {
      try {
        return parseRange(one);
      } catch (error) {
        throw new RecordingToolError(error instanceof Error ? error.message : String(error));
      }
    }
    const r = (one ?? {}) as { start?: unknown; end?: unknown };
    return { start: Number(r.start), end: Number(r.end) };
  });
}

const title = (text: unknown) =>
  typeof text === 'string' && text.trim()
    ? {
        kind: 'title' as const,
        text: text.trim().slice(0, 120),
        duration: 3,
        fadeIn: 0.5,
        fadeOut: 0.5,
      }
    : null;

export async function callRecordingTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const db = serviceClient();
  const id = typeof args.recording_id === 'string' ? args.recording_id.trim() : '';
  switch (name) {
    case 'list_recordings': {
      await sweepStaleEdits(db).catch(() => undefined);
      return { recordings: (await listOwnedRecordings(db, userId, 100)).map(toView) };
    }
    case 'get_recording': {
      const row = await getOwnedRecording(db, userId, id);
      if (!row) throw new RecordingToolError('No such recording. Use list_recordings.');
      return { recording: toView(row) };
    }
    case 'edit_recording': {
      const plan = {
        keep: keepRanges(args.keep),
        fadeIn: typeof args.fade_in === 'number' ? args.fade_in : 0,
        fadeOut: typeof args.fade_out === 'number' ? args.fade_out : 0,
        intro: title(args.intro_title),
        outro: title(args.outro_title),
      };
      try {
        const row = await createEdit(db, userId, id, { plan, subject: args.subject });
        return {
          recording: toView(row),
          next: 'Poll get_recording with this id until status is ready.',
        };
      } catch (error) {
        if (error instanceof RecordingEditError) throw new RecordingToolError(error.message);
        throw error;
      }
    }
    default:
      throw new RecordingToolError(`Unknown tool: ${name}`);
  }
}
