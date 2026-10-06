/**
 * Partner apps (e.g. qrypt.chat) that run end-to-end encrypted calls on
 * PairUX's SFU through @profullstack/pairux-embed.
 *
 * A partner's SERVER holds a key `pux_pk_…` and calls POST /api/v1/partner/token
 * to mint a LiveKit token for one of its users. PairUX never sees partner user
 * accounts, and never sees the media: the partner shares the media key between
 * its participants over its own encrypted channel. Rooms live in the partner's
 * own namespace (`partner-<id>-<room>`), which recording, restreaming and call
 * analysis never touch (they only act on `session-*` rooms).
 *
 * Configuration, no database: PAIRUX_PARTNERS is JSON
 *   [{ "id": "qrypt", "name": "qrypt.chat", "keySha256": "<hex>", "maxParticipants": 16 }]
 * Only the SHA-256 of a key is stored, so the env never holds a usable key.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export interface Partner {
  id: string;
  name: string;
  keySha256: string;
  maxParticipants: number;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

export function partnersFromEnv(raw = process.env.PAIRUX_PARTNERS): Partner[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((p: Partial<Partner>) =>
    typeof p.id === 'string' &&
    ID_RE.test(p.id) &&
    typeof p.keySha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(p.keySha256)
      ? [
          {
            id: p.id,
            name: typeof p.name === 'string' ? p.name : p.id,
            keySha256: p.keySha256,
            maxParticipants: Number(p.maxParticipants) > 0 ? Number(p.maxParticipants) : 16,
          },
        ]
      : []
  );
}

export const hashPartnerKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** The partner whose key is presented as `Authorization: Bearer pux_pk_…`, or null. */
export function authenticatePartner(
  request: Request,
  partners = partnersFromEnv()
): Partner | null {
  const match = /^Bearer\s+(pux_pk_[A-Za-z0-9_-]{20,})$/.exec(
    request.headers.get('authorization') ?? ''
  );
  if (!match?.[1]) return null;
  const presented = Buffer.from(hashPartnerKey(match[1]), 'hex');
  for (const p of partners) {
    const expected = Buffer.from(p.keySha256, 'hex');
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) return p;
  }
  return null;
}

/** The LiveKit room for a partner's room id: always inside its own namespace. */
export const partnerRoomName = (partner: Partner, room: string) => `partner-${partner.id}-${room}`;
