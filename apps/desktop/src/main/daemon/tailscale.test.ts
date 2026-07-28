import { describe, it, expect } from 'vitest';
import { isTailnetAddress } from './tailscale';

describe('isTailnetAddress', () => {
  // Tailscale allocates from the CGNAT range 100.64.0.0/10. A peer tells us
  // its address over the session data channel, so this also stops us probing
  // whatever a peer happens to send.
  it('accepts addresses in the tailnet range', () => {
    expect(isTailnetAddress('100.64.0.1')).toBe(true);
    expect(isTailnetAddress('100.101.102.103')).toBe(true);
    expect(isTailnetAddress('100.127.255.254')).toBe(true);
    expect(isTailnetAddress('  100.99.1.1  ')).toBe(true);
  });

  // 100.x exists outside the CGNAT block as ordinary public space.
  it('rejects 100.x addresses outside the range', () => {
    expect(isTailnetAddress('100.63.255.255')).toBe(false);
    expect(isTailnetAddress('100.128.0.1')).toBe(false);
  });

  it('rejects anything that is not a tailnet address', () => {
    expect(isTailnetAddress('192.168.1.5')).toBe(false);
    expect(isTailnetAddress('10.0.0.1')).toBe(false);
    expect(isTailnetAddress('')).toBe(false);
    expect(isTailnetAddress('not-an-ip')).toBe(false);
    expect(isTailnetAddress('100.64.0.1; rm -rf /')).toBe(false);
  });
});

// The whole point of M1 is telling a direct WireGuard path from a DERP relay:
// direct is a real win, DERP is just another relay and buys nothing over the
// TURN server already in place. These pin the parsing of `tailscale ping`,
// which cannot be exercised on a machine without Tailscale.
describe('tailscale ping output shapes', () => {
  const parse = (output: string) => {
    const via = /via ([^\s]+(?:\([^)]*\))?)/.exec(output)?.[1] ?? null;
    const reachable = /pong from/i.test(output);
    return { reachable, via, direct: reachable && via !== null && !/^DERP/i.test(via) };
  };

  it('reads a direct path as direct', () => {
    const r = parse('pong from bonita (100.101.102.103) via 192.0.2.7:41641 in 8ms');
    expect(r).toMatchObject({ reachable: true, direct: true, via: '192.0.2.7:41641' });
  });

  it('reads a DERP path as relayed, not direct', () => {
    const r = parse('pong from bonita (100.101.102.103) via DERP(lhr) in 24ms');
    expect(r).toMatchObject({ reachable: true, direct: false });
    expect(r.via).toMatch(/^DERP/);
  });

  it('reads an unreachable peer as neither', () => {
    const r = parse('no matching peer');
    expect(r).toMatchObject({ reachable: false, direct: false, via: null });
  });
});
