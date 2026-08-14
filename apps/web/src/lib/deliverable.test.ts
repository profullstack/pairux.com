import { describe, it, expect } from 'vitest';
import { isDeliverableAddress, partitionDeliverable } from './deliverable';

describe('isDeliverableAddress', () => {
  it('accepts ordinary addresses, including plus tags and long TLDs', () => {
    expect(isDeliverableAddress('stansukachov@gmail.com')).toBe(true);
    expect(isDeliverableAddress('anthony+foo@profullstack.com')).toBe(true);
    expect(isDeliverableAddress('hayashi_loveget@yahoo.co.jp')).toBe(true);
    expect(isDeliverableAddress('clearframe-ugig@agentmail.to')).toBe(true);
  });

  it('rejects the reserved domains Resend 422s on', () => {
    expect(isDeliverableAddress('plus-e2e-1783677471@example.com')).toBe(false);
    expect(isDeliverableAddress('a@example.net')).toBe(false);
    expect(isDeliverableAddress('a@example.org')).toBe(false);
    expect(isDeliverableAddress('a@anything.test')).toBe(false);
    expect(isDeliverableAddress('a@anything.invalid')).toBe(false);
    expect(isDeliverableAddress('a@host.localhost')).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isDeliverableAddress('  PLUS-E2E@EXAMPLE.COM ')).toBe(false);
    expect(isDeliverableAddress(' Real@Gmail.com ')).toBe(true);
  });

  it('rejects addresses that are not addresses', () => {
    expect(isDeliverableAddress('')).toBe(false);
    expect(isDeliverableAddress('nodomain')).toBe(false);
    expect(isDeliverableAddress('no@tld')).toBe(false);
    expect(isDeliverableAddress('two@at@signs.com')).toBe(false);
  });

  it('does not reject a real domain that merely contains a reserved word', () => {
    expect(isDeliverableAddress('a@example-company.com')).toBe(true);
    expect(isDeliverableAddress('a@testing.com')).toBe(true);
  });
});

describe('partitionDeliverable', () => {
  it('separates sendable addresses from the rest, preserving order', () => {
    const { deliverable, skipped } = partitionDeliverable([
      'a@real.com',
      'plus-e2e@example.com',
      'b@real.com',
    ]);
    expect(deliverable).toEqual(['a@real.com', 'b@real.com']);
    expect(skipped).toEqual(['plus-e2e@example.com']);
  });
});
