import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBanner } from './error-banner';

describe('ErrorBanner', () => {
  it('shows the message verbatim, including a raw fetch error', () => {
    const raw = 'fetch failed (Connection timed out | UND_ERR_CONNECT_TIMEOUT | pairux.com:443)';
    render(<ErrorBanner message={raw} />);

    expect(screen.getByRole('alert')).toHaveTextContent(raw);
  });

  it('renders no affordances when neither handler is given', () => {
    render(<ErrorBanner message="Something went wrong" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Could not reach pairux.com" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers retry and dismiss independently', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorBanner message="Could not reach pairux.com" onRetry={onRetry} onDismiss={onDismiss} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses a custom retry label when given', () => {
    render(<ErrorBanner message="Disconnected" onRetry={vi.fn()} retryLabel="Retry" />);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
