import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, User, ChevronDown, Settings } from 'lucide-react';
import { isElectron, getElectronAPI } from '../../lib/ipc';
import { useAuthStore } from '@/stores/auth';

export function TitleBar() {
  const platform = isElectron() ? getElectronAPI().platform : 'unknown';
  const isMac = platform === 'darwin';
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    void navigate('/login');
  };

  return (
    <header
      className={`drag-region h-10 border-border bg-card flex shrink-0 items-center border-b ${
        isMac ? 'pl-20' : 'pl-4'
      } pr-4`}
    >
      <div className="no-drag gap-2 flex items-center">
        <img
          src={`${import.meta.env.BASE_URL}logo.light.svg`}
          alt="PairUX"
          className="h-7 w-auto"
        />
      </div>

      <div className="flex-1" />

      {user && (
        <div className="no-drag relative">
          <button
            onClick={() => {
              setShowMenu(!showMenu);
            }}
            className="gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground flex items-center transition-colors"
          >
            <User className="h-3.5 w-3.5" />
            <span className="max-w-[120px] truncate">{user.email}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showMenu && (
            <>
              {/* Backdrop to close menu */}
              <div
                className="inset-0 fixed z-40"
                onClick={() => {
                  setShowMenu(false);
                }}
              />

              {/* Dropdown menu */}
              <div className="right-0 mt-1 w-48 rounded-md border-border bg-card py-1 shadow-lg absolute top-full z-50 border">
                <div className="border-border px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{user.email}</p>
                  <p className="text-xs text-muted-foreground">Signed in</p>
                </div>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    void navigate('/settings');
                  }}
                  className="gap-2 px-3 py-2 text-sm hover:bg-muted flex w-full items-center transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    void handleLogout();
                  }}
                  className="gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted flex w-full items-center transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}
