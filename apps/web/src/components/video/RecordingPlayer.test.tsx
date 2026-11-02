import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { RecordingPlayer, migrateLegacyPlayerStorage } from './RecordingPlayer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

beforeEach(() => {
  window.localStorage.clear();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});

describe('RecordingPlayer', () => {
  it('mounts @profullstack/player around the recording', () => {
    const { container } = render(
      <RecordingPlayer src="https://media.example/rec.mp4" mediaId="session:abc" />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('pux-player')).toBe(true);
    const video = root.querySelector('video');
    expect(video).not.toBeNull();
    // The player drives the server-rendered element and takes over its controls.
    expect(video?.controls).toBe(false);
    expect(root.querySelector('[data-control="play"]')).not.toBeNull();
    expect(root.querySelector('[data-control="share"]')).not.toBeNull();
  });

  it('drops the share button inside an embed', () => {
    const { container } = render(
      <RecordingPlayer
        src="https://media.example/rec.mp4"
        mediaId="session:abc"
        shareable={false}
      />
    );
    const share = container.querySelector<HTMLButtonElement>('[data-control="share"]');
    expect(share === null || share.hidden).toBe(true);
  });
});

describe('migrateLegacyPlayerStorage', () => {
  it('carries saved positions and prefs over to the package keys, once', () => {
    const positions = JSON.stringify({ 'session:abc': { t: 120, d: 600, at: 1 } });
    window.localStorage.setItem('pairux.player.positions', positions);
    window.localStorage.setItem('pairux.player.prefs', '{"volume":0.5,"muted":false,"rate":1.5}');
    migrateLegacyPlayerStorage(window.localStorage);
    expect(window.localStorage.getItem('profullstack.player.positions')).toBe(positions);
    expect(window.localStorage.getItem('profullstack.player.prefs')).toContain('"rate":1.5');
    expect(window.localStorage.getItem('pairux.player.positions')).toBeNull();
  });

  it('never overwrites what the package already saved', () => {
    window.localStorage.setItem('profullstack.player.prefs', '{"volume":1,"muted":true,"rate":1}');
    window.localStorage.setItem('pairux.player.prefs', '{"volume":0.2,"muted":false,"rate":2}');
    migrateLegacyPlayerStorage(window.localStorage);
    expect(window.localStorage.getItem('profullstack.player.prefs')).toContain('"muted":true');
  });

  it('tolerates storage that is not there', () => {
    expect(() => migrateLegacyPlayerStorage(null)).not.toThrow();
  });
});
