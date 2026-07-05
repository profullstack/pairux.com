import { describe, expect, it } from 'vitest';
import { buildClipPrompt, buildSummaryPrompt } from './prompts.js';
import type { TranscriptInput } from './types.js';

const input: TranscriptInput = {
  title: 'Debugging auth',
  segments: [
    { startMs: 0, endMs: 4000, speaker: 'Host', text: 'The token check is off by one.' },
    { startMs: 4000, endMs: 9000, speaker: 'Viewer-1', text: 'Agreed, let us pin the clock.' },
  ],
  sceneChangesMs: [4000],
};

describe('buildSummaryPrompt', () => {
  it('includes the session title, transcript, and template guidance', () => {
    const prompt = buildSummaryPrompt(input, { template: 'support-session' });
    expect(prompt.user).toContain('Debugging auth');
    expect(prompt.user).toContain('[00:00 Host] The token check is off by one.');
    expect(prompt.system).toContain('resolution applied');
    expect(prompt.system).toContain('"tldr"');
  });

  it('defaults to the pair-programming template', () => {
    const prompt = buildSummaryPrompt(input);
    expect(prompt.system).toContain('technical decisions');
  });
});

describe('buildClipPrompt', () => {
  it('honors maxClips, platform bias, and scene changes', () => {
    const prompt = buildClipPrompt(input, { platform: 'tiktok', maxClips: 3 });
    expect(prompt.system).toContain('select the 3 best');
    expect(prompt.system).toContain('tiktok');
    expect(prompt.user).toContain('Scene-change timestamps (ms): 4000');
  });

  it('omits the scene-change line when there are none', () => {
    const prompt = buildClipPrompt({ segments: input.segments });
    expect(prompt.user).not.toContain('Scene-change');
  });
});
