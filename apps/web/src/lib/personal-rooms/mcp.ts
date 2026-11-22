/**
 * MCP tools for personal rooms: your permanent room links. They need no AI
 * copilot, so the MCP route serves them even when the copilot is off.
 */

import { serviceClient } from '@/lib/supabase/service';
import { listRooms, toView } from './store';

const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const ROOM_TOOLS = [
  {
    name: 'get_my_room',
    title: 'Get my room link',
    annotations: readOnly('Get my room link'),
    description:
      'Your default PairUX room: a permanent link (pairux.com/m/<slug>) that always leads to your call. Share it; people who open it join you while you are in the room.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_rooms',
    title: 'List my rooms',
    annotations: readOnly('List my rooms'),
    description: 'All your PairUX personal rooms (default first) with their links and settings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const ROOM_TOOL_NAMES: ReadonlySet<string> = new Set(ROOM_TOOLS.map((t) => t.name));

const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';

export async function callRoomTool(userId: string, name: string): Promise<unknown> {
  const rooms = (await listRooms(serviceClient(), userId)).map((r) => toView(r, origin()));
  if (name === 'list_rooms') return { rooms };
  const room = rooms.find((r) => r.is_default) ?? rooms[0] ?? null;
  return { room, url: room?.url ?? null };
}
