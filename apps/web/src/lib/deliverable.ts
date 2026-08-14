/**
 * Reserved domains (RFC 2606 / RFC 6761) that no mail provider will deliver to.
 * Resend rejects them with a 422, and because it validates a batch as a single
 * unit, one such address fails every other recipient in the same request — so
 * they have to be dropped before the list is handed over.
 */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/** Deliberately loose — real addresses vary far more than any regex expects. */
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** True when an address is worth handing to the mail provider at all. */
export function isDeliverableAddress(email: string): boolean {
  const address = email.trim().toLowerCase();
  if (!SHAPE.test(address)) return false;

  const domain = address.slice(address.lastIndexOf('@') + 1);
  if (RESERVED_DOMAINS.includes(domain)) return false;

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return !RESERVED_TLDS.includes(tld);
}

/** Split a recipient list into addresses worth sending to, and the rest. */
export function partitionDeliverable(emails: string[]): {
  deliverable: string[];
  skipped: string[];
} {
  const deliverable: string[] = [];
  const skipped: string[] = [];
  for (const email of emails) {
    (isDeliverableAddress(email) ? deliverable : skipped).push(email);
  }
  return { deliverable, skipped };
}
