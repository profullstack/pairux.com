import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordingNotice } from './RecordingNotice';

describe('RecordingNotice', () => {
  it('says nothing for a call that is not recorded', () => {
    const { container } = render(<RecordingNotice settings={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells everyone a public replay will go on the channel page', () => {
    render(<RecordingNotice settings={{ replay: 'public' }} />);
    expect(screen.getByTestId('replay-notice')).toHaveTextContent(
      /published on the host's channel page/
    );
    expect(screen.queryByTestId('recording-notice')).toBeNull();
  });

  it('tells everyone about a private replay too', () => {
    render(<RecordingNotice settings={{ replay: 'private' }} />);
    expect(screen.getByTestId('replay-notice')).toHaveTextContent(/visible only to them/);
  });

  it('shows both notices when the call is analysed and replayed', () => {
    render(
      <RecordingNotice
        settings={{
          replay: 'public',
          analysis: { enabled: true, kind: 'general', keepRecording: true },
        }}
      />
    );
    expect(screen.getByTestId('replay-notice')).toBeInTheDocument();
    expect(screen.getByTestId('recording-notice')).toBeInTheDocument();
  });
});
