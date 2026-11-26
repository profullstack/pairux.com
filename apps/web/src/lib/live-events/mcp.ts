/**
 * MCP tools for live events (scheduled streams on a channel). They need no AI
 * copilot, so the MCP route serves them even when the copilot is off. Same
 * store and validation as /api/v1/events and `pairux events`.
 */
import { ZodError } from 'zod';
import { SITE_URL } from '@/lib/embed';
import { serviceClient } from '@/lib/supabase/service';
import { liveEventCreateSchema, liveEventUpdateSchema } from '@/lib/validations';
import { createEvent, deleteEvent, listMyEvents, LiveEventError, updateEvent } from './store';

const fields = {
  title: {
    type: 'string',
    maxLength: 120,
    description: 'What the stream is, e.g. "Weekly outreach office hours".',
  },
  description: { type: 'string', maxLength: 500 },
  startsAt: {
    type: 'string',
    description: 'First (or only) start, ISO 8601 with an offset, e.g. 2026-11-26T09:00:00-08:00.',
  },
  durationMinutes: { type: 'integer', minimum: 15, maximum: 480 },
  channel: { type: 'string', description: 'Broadcast channel: its handle (e.g. chovy) or id.' },
  repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] },
  every: {
    type: 'integer',
    minimum: 1,
    maximum: 30,
    description: 'Repeat every N days/weeks/months (default 1).',
  },
  times: {
    type: 'integer',
    minimum: 0,
    maximum: 365,
    description: 'How many occurrences; 0 = forever.',
  },
  visibility: {
    type: 'string',
    enum: ['public', 'private'],
    description: 'public (default) lists it on the channel page and in the channel calendar feed.',
  },
  replay: {
    type: 'string',
    enum: ['off', 'private', 'public'],
    description:
      'Record each occurrence and, once it ends, show the replay on the channel page: public = everyone, private = channel managers only, off (default) = not recorded.',
  },
};

const tool = (
  name: string,
  title: string,
  description: string,
  inputSchema: object,
  hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean }
) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: {
    title,
    readOnlyHint: Boolean(hints.readOnly),
    destructiveHint: Boolean(hints.destructive),
    idempotentHint: Boolean(hints.idempotent),
    openWorldHint: false,
  },
});

export const EVENT_TOOLS = [
  tool(
    'list_events',
    'List my live events',
    'Your scheduled live streams on PairUX channels, with each public page and the channel calendar feed (webcal-subscribable).',
    { type: 'object', properties: {}, additionalProperties: false },
    { readOnly: true, idempotent: true }
  ),
  tool(
    'create_event',
    'Schedule a live event',
    'Schedule a live stream on one of your channels, once or repeating (e.g. weekly outreach). Public events appear on the channel page and in its calendar feed, with add-to-calendar links.',
    {
      type: 'object',
      properties: fields,
      required: ['title', 'startsAt', 'channel'],
      additionalProperties: false,
    },
    {}
  ),
  tool(
    'update_event',
    'Change a live event',
    'Change one of your live events. A new startsAt or repeat pattern restarts the series from that time.',
    {
      type: 'object',
      properties: { id: { type: 'string', description: 'Event id from list_events.' }, ...fields },
      required: ['id'],
      additionalProperties: false,
    },
    { idempotent: true }
  ),
  tool(
    'cancel_event',
    'Cancel a live event',
    'Cancel one of your live events (all future occurrences). It disappears from the channel page and calendar feeds.',
    {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    { destructive: true, idempotent: true }
  ),
];

export const EVENT_TOOL_NAMES: ReadonlySet<string> = new Set(EVENT_TOOLS.map((t) => t.name));

/** A message the agent should see as a tool error (bad input, not found, forbidden). */
export class EventToolError extends Error {}

export async function callEventTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const svc = serviceClient();
  try {
    switch (name) {
      case 'list_events':
        return { events: await listMyEvents(svc, userId, SITE_URL) };
      case 'create_event':
        return {
          event: await createEvent(svc, userId, liveEventCreateSchema.parse(args), SITE_URL),
        };
      case 'update_event': {
        const { id, ...rest } = args;
        return {
          event: await updateEvent(
            svc,
            userId,
            typeof id === 'string' ? id : '',
            liveEventUpdateSchema.parse(rest),
            SITE_URL
          ),
        };
      }
      case 'cancel_event':
        return await deleteEvent(svc, userId, typeof args.id === 'string' ? args.id : '');
      default:
        throw new EventToolError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof LiveEventError) throw new EventToolError(error.message);
    if (error instanceof ZodError)
      throw new EventToolError(
        error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
      );
    throw error;
  }
}
