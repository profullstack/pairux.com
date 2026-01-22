import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from './ForgotPasswordForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders forgot password form', () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('submits email for password reset', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Email sent' } }),
    } as Response);

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
    });
  });

  it('shows success message after submission', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Email sent' } }),
    } as Response);

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      expect(screen.getByText(/test@example.com/i)).toBeInTheDocument();
    });
  });

  it('displays error message on failure', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    } as Response);

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    vi.mocked(global.fetch).mockReturnValueOnce(promise as Promise<Response>);

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();

    resolvePromise!({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });
  });

  it('handles network error gracefully', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument();
    });
  });

  it('has back to sign in link', () => {
    render(<ForgotPasswordForm />);

    const backLink = screen.getByRole('link', { name: /back to sign in/i });
    expect(backLink).toHaveAttribute('href', '/login');
  });

  it('shows back to sign in link in success state', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Email sent' } }),
    } as Response);

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      const backLink = screen.getByRole('link', { name: /back to sign in/i });
      expect(backLink).toHaveAttribute('href', '/login');
    });
  });
});
