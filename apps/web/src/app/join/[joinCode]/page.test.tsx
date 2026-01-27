import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import JoinPage from './page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

// Helper to convert fetch URL to string safely
function urlToString(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

// Create a stable promise that resolves immediately
function createResolvedParams(joinCode: string) {
  // Create and immediately resolve the promise
  const resolved = { joinCode };
  return Promise.resolve(resolved);
}

function renderWithSuspense(ui: React.ReactElement) {
  return render(<Suspense fallback={<div>Suspense loading...</div>}>{ui}</Suspense>);
}

describe('JoinPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockReset();
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching session', async () => {
      // Mock fetch to never resolve for session lookup
      vi.mocked(global.fetch).mockImplementation((url) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { user: null, profile: null } }),
          } as Response);
        }
        // Session lookup never resolves
        return new Promise(() => {});
      });

      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      // After suspense resolves, component should show its own loading state
      await waitFor(() => {
        expect(screen.getByText('Looking up session...')).toBeInTheDocument();
      });
    });
  });

  describe('Session not found', () => {
    it('shows error when session does not exist', async () => {
      vi.mocked(global.fetch).mockImplementation((url) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { user: null, profile: null } }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Session not found' }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const params = createResolvedParams('INVALID');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Session Not Found')).toBeInTheDocument();
      });
      expect(screen.getByText('Session not found')).toBeInTheDocument();
    });
  });

  describe('Guest user flow', () => {
    const mockSessionData = {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { maxParticipants: 5 },
      participant_count: 2,
    };

    beforeEach(() => {
      vi.mocked(global.fetch).mockImplementation((url) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { user: null, profile: null } }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/ABC123')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockSessionData }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('shows session info and name input for guests', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Join Session' })).toBeInTheDocument();
      });

      expect(screen.getByText('ABC123')).toBeInTheDocument();
      expect(screen.getByText('2 / 5')).toBeInTheDocument();
      expect(screen.getByLabelText('Your Name')).toBeInTheDocument();
      expect(screen.getByText(/Have an account\?/)).toBeInTheDocument();
    });

    it('disables join button when name is empty', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Join Session' })).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: 'Join Session' })).toBeDisabled();
    });

    it('enables join button when name is entered', async () => {
      const user = userEvent.setup();
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByLabelText('Your Name')).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText('Your Name'), 'Test User');

      expect(screen.getByRole('button', { name: 'Join Session' })).toBeEnabled();
    });

    it('calls join API and redirects on success', async () => {
      const user = userEvent.setup();

      vi.mocked(global.fetch).mockImplementation((url, options) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { user: null, profile: null } }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/ABC123')) {
          if (options?.method === 'POST') {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ data: { id: 'p-123', session_id: 'session-123' } }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockSessionData }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByLabelText('Your Name')).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText('Your Name'), 'Test User');
      await user.click(screen.getByRole('button', { name: 'Join Session' }));

      // Guests are redirected to the public view page with their participant ID
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/view/session-123?p=p-123');
      });
    });

    it('shows error message when join fails', async () => {
      const user = userEvent.setup();

      vi.mocked(global.fetch).mockImplementation((url, options) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { user: null, profile: null } }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/ABC123')) {
          if (options?.method === 'POST') {
            return Promise.resolve({
              ok: false,
              json: () => Promise.resolve({ error: 'Session is full' }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockSessionData }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByLabelText('Your Name')).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText('Your Name'), 'Test User');
      await user.click(screen.getByRole('button', { name: 'Join Session' }));

      await waitFor(() => {
        expect(screen.getByText('Session is full')).toBeInTheDocument();
      });
    });
  });

  describe('Authenticated user flow', () => {
    const mockSessionData = {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { maxParticipants: 5 },
      participant_count: 2,
    };

    const mockUserData = {
      user: { id: 'user-123', email: 'test@example.com' },
      profile: { id: 'user-123', email: 'test@example.com', display_name: 'John Doe' },
    };

    beforeEach(() => {
      vi.mocked(global.fetch).mockImplementation((url) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockUserData }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/ABC123')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockSessionData }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('shows signed in status for authenticated users', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Signed in as John Doe')).toBeInTheDocument();
      });
    });

    it('pre-fills display name from profile', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });
    });

    it('does not show sign in link for authenticated users', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Signed in as John Doe')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Have an account\?/)).not.toBeInTheDocument();
    });

    it('enables join button without requiring name input', async () => {
      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Join Session' })).toBeInTheDocument();
      });

      // Button should be enabled even with empty custom name (uses profile name)
      expect(screen.getByRole('button', { name: 'Join Session' })).toBeEnabled();
    });

    it('allows authenticated user to set custom display name', async () => {
      const user = userEvent.setup();

      vi.mocked(global.fetch).mockImplementation((url, options) => {
        if (urlToString(url).includes('/api/auth/session')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockUserData }),
          } as Response);
        }
        if (urlToString(url).includes('/api/sessions/join/ABC123')) {
          if (options?.method === 'POST') {
            const body = JSON.parse(options.body as string) as { displayName?: string };
            expect(body.displayName).toBe('Custom Name');
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ data: { participant_id: 'p-123' } }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: mockSessionData }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const params = createResolvedParams('ABC123');

      await act(async () => {
        renderWithSuspense(<JoinPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      const input = screen.getByDisplayValue('John Doe');
      await user.clear(input);
      await user.type(input, 'Custom Name');
      await user.click(screen.getByRole('button', { name: 'Join Session' }));

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/session/session-123');
      });
    });
  });
});
