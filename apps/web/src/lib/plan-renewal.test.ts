import { describe, expect, it } from 'vitest';
import { dueRenewalLead, renewalEmail } from './plan-renewal';

const now = new Date('2026-10-21T12:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe('plan renewal reminders', () => {
  it('picks the tightest band that is still true', () => {
    expect(dueRenewalLead(at(24 * 5), now)).toBeNull();
    expect(dueRenewalLead(at(72), now)).toBe('3d');
    expect(dueRenewalLead(at(30), now)).toBe('3d');
    expect(dueRenewalLead(at(24), now)).toBe('1d');
    expect(dueRenewalLead(at(1), now)).toBe('1d');
    expect(dueRenewalLead(at(0), now)).toBe('expired');
    expect(dueRenewalLead(at(-70), now)).toBe('expired');
    expect(dueRenewalLead(at(-73), now)).toBeNull();
  });

  it('links a one-click renewal and says nothing renews on its own', () => {
    const mail = renewalEmail({
      lead: '1d',
      planName: 'Pro',
      priceUsd: 12,
      expiresAt: at(20),
      renewUrl: 'https://pairux.com/upgrade/pro',
      name: 'Sam',
    });
    expect(mail.subject).toBe('Your PairUX Pro plan ends tomorrow');
    expect(mail.html).toContain('href="https://pairux.com/upgrade/pro"');
    expect(mail.html).toContain('Renew Pro: $12 for 31 days');
    expect(mail.html).toContain('do not renew on their own');
    expect(mail.html).not.toContain('—');
    expect(
      renewalEmail({
        ...{
          lead: 'expired' as const,
          planName: 'Plus',
          priceUsd: 1,
          expiresAt: at(-1),
          renewUrl: 'u',
          name: null,
        },
      }).subject
    ).toBe('Your PairUX Plus plan has ended');
  });
});
