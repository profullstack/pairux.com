import { z } from 'zod';

import { MAX_SCHEDULED_MEETING_DURATION_MINUTES } from './scheduled-meeting-timing';
import { isValidTimezone, normalizeAvailability, type WeeklyAvailability } from './booking-slots';

/** /book/<username>/<slug>: lower-case, digits and hyphens, no leading or trailing hyphen. */
export const BOOKING_SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** "Intro call (30 min)" → "intro-call-30-min". */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'call';
}

const availabilitySchema = z.unknown().transform((value, ctx): WeeklyAvailability => {
  try {
    return normalizeAvailability(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'invalid availability',
    });
    return z.NEVER;
  }
});

const timezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .refine(isValidTimezone, 'Timezone must be an IANA zone such as America/Los_Angeles');

export const bookingPageInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(100, 'Title must be under 100 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(BOOKING_SLUG, 'Slug may contain lower-case letters, digits and hyphens')
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be under 1000 characters')
    .nullable()
    .optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5, 'Duration must be at least 5 minutes')
    .max(MAX_SCHEDULED_MEETING_DURATION_MINUTES, 'Duration is too long'),
  timezone: timezoneSchema,
  availability: availabilitySchema,
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  minNoticeMinutes: z.number().int().min(0).max(20160).default(60),
  maxDaysAhead: z.number().int().min(1).max(365).default(30),
  active: z.boolean().default(true),
});

export type BookingPageInput = z.infer<typeof bookingPageInputSchema>;

export const bookingPageUpdateSchema = bookingPageInputSchema.partial();

export type BookingPageUpdate = z.infer<typeof bookingPageUpdateSchema>;

/** What a guest sends to take a slot. */
export const bookRequestSchema = z.object({
  start: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), 'start must be an ISO timestamp'),
  name: z
    .string()
    .trim()
    .min(1, 'Your name is required')
    .max(80, 'Name must be under 80 characters'),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address'),
  notes: z.string().trim().max(1000, 'Notes must be under 1000 characters').optional(),
  /** The guest's zone, echoed into the confirmation so times read right for them. */
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone').optional(),
});

export type BookRequest = z.infer<typeof bookRequestSchema>;
