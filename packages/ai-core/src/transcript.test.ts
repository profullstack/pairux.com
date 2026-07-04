import { describe, expect, it } from 'vitest';
import { formatSegment, formatTimestamp, formatTranscript } from './transcript.js';

describe('formatTimestamp', () => {
  it('formats sub-minute and multi-minute offsets', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(9000)).toBe('00:09');
    expect(formatTimestamp(125000)).toBe('02:05');
  });

  it('clamps negative input to zero', () => {
    expect(formatTimestamp(-500)).toBe('00:00');
  });
});

describe('formatSegment / formatTranscript', () => {
  it('renders one segment', () => {
    expect(formatSegment({ startMs: 65000, endMs: 70000, speaker: 'Host', text: 'hi' })).toBe('[01:05 Host] hi');
  });

  it('joins segments with newlines', () => {
    const text = formatTranscript({
      segments: [
        { startMs: 0, endMs: 1000, speaker: 'A', text: 'one' },
        { startMs: 1000, endMs: 2000, speaker: 'B', text: 'two' },
      ],
    });
    expect(text).toBe('[00:00 A] one\n[00:01 B] two');
  });
});
