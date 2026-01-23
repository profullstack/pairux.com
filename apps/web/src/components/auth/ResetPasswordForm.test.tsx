import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordForm } from './ResetPasswordForm';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders reset password form', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
  });

  it('submits new password', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Password updated' } }),
    } as Response);

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'NewPassword123', confirmPassword: 'NewPassword123' }),
      });
    });
  });

  it('shows success message and redirects after reset', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Password updated' } }),
    } as Response);

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    });

    // Advance timers to trigger redirect
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('displays error message on failure', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Session expired' }),
    } as Response);

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    vi.mocked(global.fetch).mockReturnValueOnce(promise as Promise<Response>);

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(screen.getByText(/resetting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resetting/i })).toBeDisabled();

    resolvePromise!({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });
  });

  it('toggles password visibility for both fields', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResetPasswordForm />);

    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmInput = screen.getByLabelText(/confirm new password/i);

    expect(newPasswordInput).toHaveAttribute('type', 'password');
    expect(confirmInput).toHaveAttribute('type', 'password');

    const toggleButtons = screen.getAllByRole('button');
    const toggleButton = toggleButtons.find((btn) => btn.getAttribute('type') === 'button');
    await user.click(toggleButton!);

    expect(newPasswordInput).toHaveAttribute('type', 'text');
    expect(confirmInput).toHaveAttribute('type', 'text');
  });

  it('handles network error gracefully', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument();
    });
  });

  it('shows password requirements hint', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('has sign in now link in success state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { message: 'Password updated' } }),
    } as Response);

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      const signInLink = screen.getByRole('link', { name: /sign in now/i });
      expect(signInLink).toHaveAttribute('href', '/login');
    });
  });
});
