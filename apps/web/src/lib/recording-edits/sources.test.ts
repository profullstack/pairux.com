import { describe, expect, it, vi } from 'vitest';
import { RecordingEditError, preparePlan } from './sources';

const MINE = '11111111-1111-4111-8111-111111111111';
const keep = [{ start: 10, end: 70 }];
const lookup = vi.fn((id: string) =>
  Promise.resolve(id === MINE ? `https://storage.example/recordings/${id}.mp4` : null)
);

async function rejects(plan: unknown, status: number, match: RegExp) {
  const err = await preparePlan(plan, 3600, lookup).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RecordingEditError);
  expect((err as RecordingEditError).status).toBe(status);
  expect((err as RecordingEditError).message).toMatch(match);
}

describe('preparePlan (cloud edit source guard)', () => {
  it('refuses any intro/outro source that is not one of your recordings', async () => {
    for (const source of [
      'https://evil.example/x.mp4',
      'http://169.254.169.254/latest/meta-data',
      '/etc/passwd',
      'file:///etc/passwd',
      'concat:/a|/b',
      'recording:not-a-uuid',
    ]) {
      await rejects({ keep, intro: { kind: 'file', source } }, 400, /one of your recordings/);
      await rejects(
        { keep, outro: { kind: 'image', source, duration: 3 } },
        400,
        /one of your recordings/
      );
    }
  });

  it('refuses a recording that is not yours (or not ready)', async () => {
    await rejects(
      { keep, intro: { kind: 'file', source: 'recording:22222222-2222-4222-8222-222222222222' } },
      404,
      /not yours/
    );
  });

  it('resolves your recording to its storage URL for rendering, and keeps the id in the stored plan', async () => {
    const { stored, render } = await preparePlan(
      { keep, outro: { kind: 'file', source: `recording:${MINE}` } },
      3600,
      lookup
    );
    expect(stored.outro).toMatchObject({ kind: 'file', source: `recording:${MINE}` });
    expect(render.outro).toMatchObject({
      kind: 'file',
      source: `https://storage.example/recordings/${MINE}.mp4`,
    });
  });

  it('allows title cards and validates the plan', async () => {
    const { render } = await preparePlan(
      { keep, intro: { kind: 'title', text: 'Demo', duration: 3 } },
      3600,
      lookup
    );
    expect(render.intro).toMatchObject({ kind: 'title', text: 'Demo' });
    await rejects({ keep: [] }, 400, /at least one range/);
    await rejects({ keep, fadeIn: 50 }, 400, /fadeIn/);
  });
});
