'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Menu, X, Monitor, LogOut, Settings, LayoutDashboard, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const navigation = [
  { name: 'Features', href: '/features' },
  { name: 'Download', href: '/download' },
  { name: 'Docs', href: '/docs' },
  { name: 'Pricing', href: '/pricing' },
];

export function Header() {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    // Get initial session
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    void getUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setDropdownOpen(false);
    router.push('/');
    router.refresh();
  };

  const metadata = user?.user_metadata as { first_name?: string; last_name?: string } | undefined;
  const firstName = metadata?.first_name ?? '';
  const lastName = metadata?.last_name ?? '';

  const userInitials = firstName && lastName
    ? `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
    : user?.email?.charAt(0).toUpperCase() ?? 'U';

  const userName = firstName && lastName
    ? `${firstName} ${lastName}`
    : user?.email ?? 'User';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white/80 backdrop-blur-lg">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
            <Monitor className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">PairUX</span>
        </Link>

        {/* Desktop navigation */}
        <div className="hidden md:flex md:items-center md:gap-8">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
            >
              {item.name}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex md:items-center md:gap-4">
          <Link
            href="https://github.com/profullstack/pairux.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            <GitHubIcon className="h-5 w-5" />
          </Link>

          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-lg bg-gray-200" />
          ) : user ? (
            // Logged in state
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => { setDropdownOpen(!dropdownOpen); }}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
                  {userInitials}
                </div>
                <ChevronDown className={cn('h-4 w-4 transition-transform', dropdownOpen && 'rotate-180')} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{userName}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => { setDropdownOpen(false); }}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </Link>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => { setDropdownOpen(false); }}
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => { void handleLogout(); }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Logged out state
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
              >
                Sign up
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          className="md:hidden rounded-lg p-2 text-gray-600 hover:bg-gray-100"
          onClick={() => { setMobileMenuOpen(!mobileMenuOpen); }}
        >
          <span className="sr-only">Open menu</span>
          {mobileMenuOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        className={cn(
          'md:hidden',
          mobileMenuOpen ? 'block' : 'hidden'
        )}
      >
        <div className="space-y-1 px-4 pb-4">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              onClick={() => { setMobileMenuOpen(false); }}
            >
              {item.name}
            </Link>
          ))}
          <Link
            href="https://github.com/profullstack/pairux.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={() => { setMobileMenuOpen(false); }}
          >
            <GitHubIcon className="h-5 w-5" />
            <span>GitHub</span>
          </Link>

          {/* Mobile auth section */}
          {!loading && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              {user ? (
                <>
                  <div className="flex items-center gap-3 px-3 py-2 mb-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
                      {userInitials}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{userName}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                  </div>
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <LayoutDashboard className="h-5 w-5" />
                    Dashboard
                  </Link>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    <Settings className="h-5 w-5" />
                    Settings
                  </Link>
                  <button
                    onClick={() => {
                      void handleLogout();
                      setMobileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-5 w-5" />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="block rounded-lg px-3 py-2 text-base font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    className="block rounded-lg bg-primary-600 px-3 py-2 text-center text-base font-semibold text-white hover:bg-primary-700"
                    onClick={() => { setMobileMenuOpen(false); }}
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
