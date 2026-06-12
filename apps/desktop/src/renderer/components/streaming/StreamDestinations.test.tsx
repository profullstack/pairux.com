import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StreamDestinations } from './StreamDestinations';
import type { RTMPDestinationInfo } from '../../../preload/api';

const dest: RTMPDestinationInfo = {
  id: 'yt-1',
  name: 'YouTube',
  platform: 'youtube',
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  streamKeyId: 'key-1',
  enabled: true,
  encoderSettings: {
    videoBitrate: 4500,
    resolution: '1080p',
    framerate: 30,
    keyframeInterval: 2,
    audioBitrate: 128,
  },
};

const onAdd = vi.fn().mockResolvedValue(undefined);
const onUpdate = vi.fn().mockResolvedValue(undefined);
const onRemove = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StreamDestinations', () => {
  it('saves an edit without re-entering the stream key', async () => {
    // Regression: handleSubmit required a non-empty stream key even when
    // editing (the key field is intentionally blank on edit), so every
    // settings edit silently did nothing.
    render(
      <StreamDestinations
        destinations={[dest]}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
    const [id, updates, newKey] = onUpdate.mock.calls[0] as [
      string,
      { encoderSettings: typeof dest.encoderSettings },
      string | undefined,
    ];
    expect(id).toBe('yt-1');
    expect(updates.encoderSettings).toEqual(dest.encoderSettings);
    // No key typed -> keep the stored one rather than overwriting with ''.
    expect(newKey).toBeUndefined();
  });

  it('still requires a stream key when adding a new destination', async () => {
    render(
      <StreamDestinations destinations={[]} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />
    );

    fireEvent.click(screen.getByRole('button', { name: /add destination/i }));
    const addButton = await screen.findByRole('button', { name: 'Add' });
    expect(addButton).toBeDisabled();
    fireEvent.click(addButton);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
