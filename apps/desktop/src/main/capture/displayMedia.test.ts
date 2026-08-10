import { beforeEach, describe, expect, it } from 'vitest';
import {
  pickDisplayMediaSource,
  resetPreferredDisplayMediaSource,
  setPreferredDisplayMediaSource,
  takePreferredDisplayMediaSource,
} from './displayMedia';

const screen = { id: 'screen:0:0', name: 'Entire Screen' };
const editor = { id: 'window:1234:0', name: 'Editor' };
const terminal = { id: 'window:5678:0', name: 'Terminal' };

describe('pickDisplayMediaSource', () => {
  // The whole point of the preference: without it the handler could only ever
  // grant sources[0], which silently shared the wrong window.
  it('grants the source the user actually picked', () => {
    expect(pickDisplayMediaSource([screen, editor, terminal], terminal.id)).toBe(terminal);
  });

  it('falls back to the first source when nothing was recorded', () => {
    expect(pickDisplayMediaSource([screen, editor], null)).toBe(screen);
  });

  // A window closed between the pick and the request should not fail capture.
  it('falls back to the first source when the pick has disappeared', () => {
    expect(pickDisplayMediaSource([screen, editor], 'window:9999:0')).toBe(screen);
  });

  it('returns null when there is nothing to grant', () => {
    expect(pickDisplayMediaSource([], null)).toBeNull();
    expect(pickDisplayMediaSource([], screen.id)).toBeNull();
  });
});

describe('preferred display media source', () => {
  beforeEach(() => {
    resetPreferredDisplayMediaSource();
  });

  it('is empty until the renderer records a pick', () => {
    expect(takePreferredDisplayMediaSource()).toBeNull();
  });

  it('hands back what was recorded', () => {
    setPreferredDisplayMediaSource(editor.id);
    expect(takePreferredDisplayMediaSource()).toBe(editor.id);
  });

  // Consumed once, so a later unattributed request (capture restarted from the
  // portal picker) cannot silently reuse a stale pick.
  it('clears itself after being read', () => {
    setPreferredDisplayMediaSource(editor.id);
    takePreferredDisplayMediaSource();

    expect(takePreferredDisplayMediaSource()).toBeNull();
  });

  it('can be cleared explicitly', () => {
    setPreferredDisplayMediaSource(editor.id);
    setPreferredDisplayMediaSource(null);

    expect(takePreferredDisplayMediaSource()).toBeNull();
  });
});
