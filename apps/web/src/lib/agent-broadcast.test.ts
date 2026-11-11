import { describe, expect, it, vi } from 'vitest';
import {
  BroadcastError,
  endBroadcast,
  heartbeatBroadcast,
  publisherGrant,
  startBroadcast,
  startBroadcastSchema,
} from './agent-broadcast';
import type { Db } from '@/lib/orgs';

const tokenCtor = vi.fn();
const tokenGrant = vi.fn();
vi.mock('livekit-server-sdk', () => ({
  TrackSource: { MICROPHONE: 2, CAMERA: 1 },
  AccessToken: vi.fn().mockImplementation((...args: unknown[]) => {
    tokenCtor(...args);
    return { addGrant: tokenGrant, toJwt: () => Promise.resolve('jwt') };
  }),
}));
vi.mock('@/lib/orgs', () => ({ resolveUserPlan: () => Promise.resolve('free') }));

const OWNER = '11111111-1111-4111-8111-111111111111';
const AGENT = { id: '22222222-2222-4222-8222-222222222222', name: 'riotcoder', ownerUserId: OWNER };
const CHANNEL = {
  id: '33333333-3333-4333-8333-333333333333',
  handle: 'moshcoding',
  name: 'Moshcoding',
  owner_id: OWNER,
  org_id: null,
  team_id: null,
};
const LIVEKIT = {
  apiKey: 'APIkey',
  apiSecret: 'a-secret-long-enough-for-hs256-signing!!',
  url: 'wss://sfu.test',
};

/** Just enough of the supabase builder for the calls the lib makes. */
function fakeDb(opts: { channel?: unknown; allowed?: boolean; session?: unknown }) {
  const calls: { table: string; op: string; payload?: unknown; filters: unknown[] }[] = [];
  const builder = (table: string) => {
    const call = { table, op: 'select', payload: undefined as unknown, filters: [] as unknown[] };
    calls.push(call);
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return b;
      };
    for (const name of ['select', 'eq', 'ilike', 'not']) b[name] = chain(name);
    b.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return b;
    };
    b.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return b;
    };
    const answer = () => {
      if (table === 'channels') return { data: opts.channel ?? null };
      if (call.op === 'insert')
        return {
          data: { id: '44444444-4444-4444-8444-444444444444', join_code: 'ABC234' },
          error: null,
        };
      if (call.op === 'update') return { data: [{ id: 'x' }] };
      return { data: opts.session ?? null };
    };
    b.maybeSingle = () => Promise.resolve(answer());
    b.single = () => Promise.resolve(answer());
    b.then = (resolve: (value: unknown) => void) => resolve(answer());
    return b;
  };
  const db = { from: builder, rpc: () => Promise.resolve({ data: opts.allowed ?? false }) };
  return { db: db as unknown as Db, calls };
}

describe('startBroadcastSchema', () => {
  it('takes a handle with or without @', () => {
    expect(startBroadcastSchema.parse({ channel: '@MoshCoding', title: 'Ep 1' }).channel).toBe(
      'moshcoding'
    );
    expect(() => startBroadcastSchema.parse({ channel: 'bad handle', title: 'x' })).toThrow();
    expect(() => startBroadcastSchema.parse({ channel: 'ok', title: '' })).toThrow();
  });
});

describe('publisherGrant', () => {
  it('publishes into one room and subscribes to nothing', () => {
    const grant = publisherGrant('abc');
    expect(grant.room).toBe('session-abc');
    expect(grant.canSubscribe).toBe(false);
    expect(grant.canPublishData).toBe(false);
  });
});

describe('startBroadcast', () => {
  it('opens a public live room on the channel with the owner as host', async () => {
    const { db, calls } = fakeDb({ channel: CHANNEL, allowed: true });
    const { broadcast } = await startBroadcast(
      db,
      AGENT,
      { channel: 'moshcoding', title: 'TUI Weekly' },
      LIVEKIT
    );
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toMatchObject({
      channel_id: CHANNEL.id,
      current_host_id: OWNER,
      host_user_id: OWNER,
      is_public: true,
      mode: 'sfu',
      subject: 'TUI Weekly',
      settings: { broadcast: { agentId: AGENT.id } },
    });
    expect(broadcast.joinCode).toBe('ABC234');
    expect(broadcast.liveUrl).toMatch(/\/l\/ABC234$/);
    expect(broadcast.channelUrl).toMatch(/\/@moshcoding$/);
    expect(broadcast.token).toBe('jwt');
    // The host identity is what lets the webhook end the live when the publisher leaves.
    expect(tokenCtor.mock.calls.at(-1)?.[2]).toMatchObject({ identity: OWNER });
    expect(tokenGrant.mock.calls.at(-1)?.[0]).toMatchObject({
      room: `session-${broadcast.sessionId}`,
      canSubscribe: false,
    });
  });

  it('refuses a channel the owner may not use, and an unknown one', async () => {
    await expect(
      startBroadcast(
        fakeDb({ channel: CHANNEL, allowed: false }).db,
        AGENT,
        { channel: 'moshcoding', title: 'x' },
        LIVEKIT
      )
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      startBroadcast(fakeDb({}).db, AGENT, { channel: 'nope', title: 'x' }, LIVEKIT)
    ).rejects.toBeInstanceOf(BroadcastError);
  });
});

describe('heartbeat + end', () => {
  const mine = { id: 's', status: 'active', settings: { broadcast: { agentId: AGENT.id } } };

  it('only the agent that started it may ping or end it', async () => {
    const other = { ...mine, settings: { broadcast: { agentId: 'someone-else' } } };
    await expect(
      heartbeatBroadcast(fakeDb({ session: other }).db, AGENT, 's')
    ).rejects.toMatchObject({ status: 404 });
    await expect(endBroadcast(fakeDb({ session: null }).db, AGENT, 's')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('pings a live one and ends it', async () => {
    expect(await heartbeatBroadcast(fakeDb({ session: mine }).db, AGENT, 's')).toEqual({
      live: true,
    });
    expect(
      await heartbeatBroadcast(fakeDb({ session: { ...mine, status: 'ended' } }).db, AGENT, 's')
    ).toEqual({ live: false });
    const { db, calls } = fakeDb({ session: mine });
    await endBroadcast(db, AGENT, 's');
    expect(calls.find((c) => c.op === 'update')?.payload).toMatchObject({
      status: 'ended',
      current_host_id: null,
    });
  });
});
