import { describe, expect, it } from 'vitest';
import { clipCandidateSchema, clipCandidatesSchema, sessionNoteSchema } from './schemas.js';

describe('sessionNoteSchema', () => {
  it('accepts a well-formed note', () => {
    const result = sessionNoteSchema.safeParse({
      tldr: 'We fixed the flaky auth test.',
      decisions: ['Pin the clock in tests'],
      actionItems: [
        { description: 'Backport the fix', owner: 'Ada', deadline: 'Friday', timestampMs: 120000 },
      ],
      topics: ['auth', 'testing'],
    });
    expect(result.success).toBe(true);
  });

  it('allows nullable owner/deadline/timestamp', () => {
    const result = sessionNoteSchema.safeParse({
      tldr: 'x',
      decisions: [],
      actionItems: [
        { description: 'Do the thing', owner: null, deadline: null, timestampMs: null },
      ],
      topics: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty tldr', () => {
    const result = sessionNoteSchema.safeParse({
      tldr: '',
      decisions: [],
      actionItems: [],
      topics: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('clipCandidateSchema', () => {
  it('rejects a clip whose end is not after its start', () => {
    const result = clipCandidateSchema.safeParse({
      startMs: 5000,
      endMs: 5000,
      title: 'Nope',
      hookCaption: 'Nope',
      platformFit: ['tiktok'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown platform', () => {
    const result = clipCandidateSchema.safeParse({
      startMs: 0,
      endMs: 1000,
      title: 'Hi',
      hookCaption: 'Hi',
      platformFit: ['myspace'],
    });
    expect(result.success).toBe(false);
  });
});

describe('clipCandidatesSchema', () => {
  const clip = {
    startMs: 0,
    endMs: 1000,
    title: 't',
    hookCaption: 'h',
    platformFit: ['shorts'] as const,
  };

  it('rejects an empty array', () => {
    expect(clipCandidatesSchema.safeParse([]).success).toBe(false);
  });

  it('rejects more than eight candidates', () => {
    const nine = Array.from({ length: 9 }, () => clip);
    expect(clipCandidatesSchema.safeParse(nine).success).toBe(false);
  });

  it('accepts a valid batch', () => {
    expect(clipCandidatesSchema.safeParse([clip, clip]).success).toBe(true);
  });
});
