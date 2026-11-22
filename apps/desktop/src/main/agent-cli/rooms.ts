/**
 * `pairux rooms ...` and `pairux room --mine`: your permanent rooms.
 *
 *   pairux room --mine                  print your default room link
 *   pairux rooms                        list them
 *   pairux rooms create "Office hours" [--slug office-hours]
 *   pairux rooms rename <room> "New name"
 *   pairux rooms slug <room> <new-slug>
 *   pairux rooms default <room>
 *   pairux rooms lock|unlock <room>
 *   pairux rooms rm <room>
 *
 * <room> is a slug or an id. Every call is signed in with `pairux login`.
 */
import { parseArgs } from 'node:util';
import type { PairuxClient, PersonalRoom } from './api';
import type { Deps } from './commands';
import { UsageError } from './errors';

export const ROOMS_HELP = `Personal rooms: permanent links (pairux.com/m/<slug>) that always lead to your call.

Usage:
  pairux room --mine [--json]                 Your default room link
  pairux rooms [--json]                       List your rooms
  pairux rooms create <name...> [--slug <s>]  Add a room
  pairux rooms rename <room> <name...>        Rename a room
  pairux rooms slug <room> <new-slug>         Change a room's link
  pairux rooms default <room>                 Make a room your default
  pairux rooms lock|unlock <room>             Stop (or allow) new people joining
  pairux rooms rm <room>                      Delete a room (not the default)
<room> is a room's slug or id.`;

function find(rooms: PersonalRoom[], ref: string | undefined): PersonalRoom {
  if (!ref) throw new UsageError('Name the room (its slug or id). `pairux rooms` lists them.');
  const r = rooms.find((x) => x.slug === ref.toLowerCase() || x.id === ref);
  if (!r) throw new UsageError(`No room "${ref}". \`pairux rooms\` lists them.`);
  return r;
}

function describe(r: PersonalRoom): string {
  const tags = [
    r.is_default ? 'default' : null,
    r.settings.locked ? 'locked' : null,
    r.settings.mode,
  ]
    .filter(Boolean)
    .join(', ');
  return `${r.url}  ${r.name} (${tags})`;
}

export async function runMyRoom(args: string[], deps: Deps, client: PairuxClient): Promise<number> {
  const rooms = await client.rooms().list();
  const room: PersonalRoom | undefined = rooms.find((r) => r.is_default) ?? rooms.at(0);
  if (!room) throw new UsageError('You have no rooms yet.');
  deps.out(args.includes('--json') ? JSON.stringify(room) : room.url);
  return 0;
}

export async function runRooms(args: string[], deps: Deps, client: PairuxClient): Promise<number> {
  const api = client.rooms();
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: 'boolean' }, slug: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  const [sub = 'list', ...rest] = positionals;
  const print = (r: PersonalRoom) => {
    deps.out(values.json ? JSON.stringify(r) : describe(r));
  };

  switch (sub) {
    case 'list': {
      const rooms = await api.list();
      if (values.json) deps.out(JSON.stringify(rooms));
      else for (const r of rooms) deps.out(describe(r));
      return 0;
    }
    case 'help':
      deps.out(ROOMS_HELP);
      return 0;
    case 'create': {
      const name = rest.join(' ').trim();
      if (!name) throw new UsageError('Usage: pairux rooms create <name...> [--slug <s>]');
      print(await api.create({ name, ...(values.slug ? { slug: values.slug } : {}) }));
      return 0;
    }
    case 'rename': {
      const room = find(await api.list(), rest[0]);
      const name = rest.slice(1).join(' ').trim();
      if (!name) throw new UsageError('Usage: pairux rooms rename <room> <name...>');
      print(await api.update(room.id, { name }));
      return 0;
    }
    case 'slug': {
      const room = find(await api.list(), rest[0]);
      if (!rest[1]) throw new UsageError('Usage: pairux rooms slug <room> <new-slug>');
      print(await api.update(room.id, { slug: rest[1] }));
      return 0;
    }
    case 'default': {
      const room = find(await api.list(), rest[0]);
      print(await api.update(room.id, { is_default: true }));
      return 0;
    }
    case 'lock':
    case 'unlock': {
      const room = find(await api.list(), rest[0]);
      print(await api.update(room.id, { settings: { locked: sub === 'lock' } }));
      return 0;
    }
    case 'rm':
    case 'delete': {
      const room = find(await api.list(), rest[0]);
      await api.remove(room.id);
      deps.out(`Deleted ${room.url}`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown rooms command "${sub}". Run \`pairux rooms help\`.`);
  }
}
