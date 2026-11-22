/**
 * Personal rooms: permanent links (pairux.com/m/<slug>) to the user's call.
 *
 * GET /api/v1/me/rooms → { data: { rooms } }, default first.
 */
import { apiRequest } from '../api';

export interface PersonalRoom {
  id: string;
  slug: string;
  name: string;
  url: string;
  is_default: boolean;
  settings: { mode: 'p2p' | 'sfu'; locked: boolean };
}

export const roomsApi = {
  list() {
    return apiRequest<{ rooms: PersonalRoom[] }>('/api/v1/me/rooms');
  },
};

/** The default room, or the first one. */
export function defaultRoom(rooms: PersonalRoom[] | undefined): PersonalRoom | null {
  return rooms?.find((r) => r.is_default) ?? rooms?.[0] ?? null;
}
