/**
 * `pairux events ...`: live events on your channels (scheduled streams with a
 * public page and a subscribable calendar feed).
 *
 *   pairux events                                   list them
 *   pairux events add "Weekly outreach" --at 2026-11-26T09:00 --channel chovy --weekly
 *   pairux events edit <id> --at 2026-11-27T10:00 [--title ...] [--weekly|--once ...]
 *   pairux events public|private <id>
 *   pairux events add ... --replay public   record it and publish the replay on the channel
 *   pairux events rm <id>
 *
 * Every call is signed in with `pairux login`.
 */
import { parseArgs } from 'node:util';
import type { LiveEvent, PairuxClient } from './api';
import type { Deps } from './commands';
import { UsageError } from './errors';

export const EVENTS_HELP = `Live events: scheduled streams on your channels, each with a public page
(pairux.com/e/<id>) and listed in the channel calendar feed (webcal-subscribable).

Usage:
  pairux events [--json]                              List your events
  pairux events add <title...> --at <time> --channel <handle> [options]
  pairux events edit <id> [options]                   Change an event
  pairux events public|private <id>                   List or unlist it on the channel
  pairux events rm <id>                               Cancel it (all future occurrences)

Options:
  --at <time>            Start, e.g. 2026-11-26T09:00 (your local time) or full ISO with offset
  --channel <handle>     Broadcast channel (handle or id)
  --minutes <n>          Length in minutes (default 60, 15-480)
  --daily | --weekly | --monthly | --once   How it repeats (default --once)
  --every <n>            Every n days/weeks/months (default 1)
  --times <n>            Number of occurrences (default 0 = forever)
  --title <text>         New title (edit)
  --description <text>   Description
  --private              Create it unlisted (events are public by default)
  --replay <setting>     Record each occurrence and show the replay on the channel page
                         once it ends: public (everyone), private (you and channel
                         managers) or off (default, not recorded)
  --json                 Machine-readable output`;

const REPEATS = ['daily', 'weekly', 'monthly', 'once'] as const;
const REPLAYS = ['off', 'private', 'public'] as const;
type Replay = (typeof REPLAYS)[number];

export function parseReplay(raw: string | undefined): Replay | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if ((REPLAYS as readonly string[]).includes(v)) return v as Replay;
  throw new UsageError('--replay must be off, private or public.');
}

/** "2026-11-26T09:00" (local) or any ISO string -> ISO with offset; refuses junk. */
export function parseWhen(raw: string, now: Date = new Date()): string {
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw.trim());
  const d = local
    ? new Date(
        Number(local[1]),
        Number(local[2]) - 1,
        Number(local[3]),
        Number(local[4]),
        Number(local[5])
      )
    : new Date(raw);
  if (Number.isNaN(d.getTime()))
    throw new UsageError(`Can't read the time "${raw}". Try 2026-11-26T09:00.`);
  if (d.getTime() < now.getTime() - 60_000) throw new UsageError(`${d.toString()} is in the past.`);
  return d.toISOString();
}

function int(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new UsageError(`--${name} must be a whole number.`);
  return n;
}

function describe(e: LiveEvent): string {
  const when = e.next_occurrence ?? e.starts_at;
  const repeat =
    e.repeat === 'none' ? 'once' : e.every > 1 ? `every ${String(e.every)} ${e.repeat}` : e.repeat;
  const where = e.channel ? `@${e.channel.handle}` : 'no channel';
  const link = e.url ?? '(private)';
  const replay = e.replay && e.replay !== 'off' ? `, replay ${e.replay}` : '';
  return `${e.id}  ${new Date(when).toLocaleString()}  ${e.title}  [${repeat}, ${e.visibility}${replay}, ${where}]  ${link}`;
}

export async function runEvents(args: string[], deps: Deps, client: PairuxClient): Promise<number> {
  const api = client.events();
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: 'boolean' },
      at: { type: 'string' },
      channel: { type: 'string' },
      minutes: { type: 'string' },
      every: { type: 'string' },
      times: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      private: { type: 'boolean' },
      replay: { type: 'string' },
      daily: { type: 'boolean' },
      weekly: { type: 'boolean' },
      monthly: { type: 'boolean' },
      once: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  const [sub = 'list', ...rest] = positionals;
  const print = (e: LiveEvent) => {
    deps.out(values.json ? JSON.stringify(e) : describe(e));
  };
  const picked = REPEATS.filter((r) => values[r]);
  if (picked.length > 1) throw new UsageError('Pick one of --daily, --weekly, --monthly, --once.');
  const repeat: 'none' | 'daily' | 'weekly' | 'monthly' | undefined =
    picked.length === 0 ? undefined : picked[0] === 'once' ? 'none' : picked[0];
  const replay = parseReplay(values.replay);
  const shared = {
    ...(replay !== undefined && { replay }),
    ...(values.minutes !== undefined && { durationMinutes: int('minutes', values.minutes) }),
    ...(values.every !== undefined && { every: int('every', values.every) }),
    ...(values.times !== undefined && { times: int('times', values.times) }),
    ...(values.description !== undefined && { description: values.description }),
    ...(repeat !== undefined && { repeat }),
  };

  switch (sub) {
    case 'list':
    case 'ls': {
      const events = await api.list();
      if (values.json) deps.out(JSON.stringify(events));
      else if (events.length === 0)
        deps.out(
          'No live events. Add one: pairux events add "Title" --at 2026-11-26T09:00 --channel <handle>'
        );
      else for (const e of events) deps.out(describe(e));
      return 0;
    }
    case 'help':
      deps.out(EVENTS_HELP);
      return 0;
    case 'add':
    case 'create': {
      const title = (values.title ?? rest.join(' ')).trim();
      if (!title)
        throw new UsageError(
          'Give the event a title: pairux events add "Weekly outreach" --at ... --channel ...'
        );
      if (!values.at) throw new UsageError('When? Add --at 2026-11-26T09:00.');
      if (!values.channel) throw new UsageError('Which channel? Add --channel <handle>.');
      print(
        await api.create({
          title,
          startsAt: parseWhen(values.at),
          channel: values.channel,
          visibility: values.private ? 'private' : 'public',
          ...shared,
        })
      );
      return 0;
    }
    case 'edit': {
      const id = rest[0];
      if (!id) throw new UsageError('Which event? `pairux events` lists their ids.');
      const patch = {
        ...shared,
        ...(values.title !== undefined && { title: values.title }),
        ...(values.at !== undefined && { startsAt: parseWhen(values.at) }),
        ...(values.channel !== undefined && { channel: values.channel }),
        ...(values.private && { visibility: 'private' }),
      };
      if (Object.keys(patch).length === 0)
        throw new UsageError('Nothing to change. See `pairux events help`.');
      print(await api.update(id, patch));
      return 0;
    }
    case 'public':
    case 'private': {
      const id = rest[0];
      if (!id) throw new UsageError('Which event? `pairux events` lists their ids.');
      print(await api.update(id, { visibility: sub }));
      return 0;
    }
    case 'rm':
    case 'cancel': {
      const id = rest[0];
      if (!id) throw new UsageError('Which event? `pairux events` lists their ids.');
      await api.remove(id);
      deps.out(values.json ? JSON.stringify({ id, status: 'cancelled' }) : `Cancelled ${id}.`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown events command "${sub}". See \`pairux events help\`.`);
  }
}
