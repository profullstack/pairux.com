import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { User, Crown, MessageCircle } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';

interface ParticipantItemProps {
  participant: SessionParticipant;
  isCurrentUser: boolean;
  onStartDM?: (participant: SessionParticipant) => void;
  isHostContext?: boolean;
  isMuted?: boolean;
  onGrantControl?: (participant: SessionParticipant) => void;
  onRevokeControl?: (participant: SessionParticipant) => void;
  onKickParticipant?: (participant: SessionParticipant) => void;
  onMuteParticipant?: (participant: SessionParticipant, muted: boolean) => void;
}

function stringToColor(str: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? 'bg-gray-500';
}

export const ParticipantItem = memo(function ParticipantItem({
  participant,
  isCurrentUser,
  onStartDM,
  isHostContext = false,
  isMuted = false,
  onGrantControl,
  onRevokeControl,
  onKickParticipant,
  onMuteParticipant,
}: ParticipantItemProps) {
  const isParticipantHost = participant.role === 'host';
  const avatarColor = stringToColor(participant.display_name);
  const canModerate = isHostContext && !isCurrentUser && !isParticipantHost;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const openContextMenu = (event: ReactMouseEvent) => {
    if (!canModerate) return;
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  };

  return (
    <>
      <div
        className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted"
        onContextMenu={openContextMenu}
      >
        <div
          className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
        >
          <User className="h-3.5 w-3.5 text-white" />
          {isParticipantHost && (
            <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400">
              <Crown className="h-2.5 w-2.5 text-yellow-800" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{participant.display_name}</span>
            {isCurrentUser && <span className="text-xs text-muted-foreground">(you)</span>}
          </div>
          {isParticipantHost && <span className="text-xs text-muted-foreground">Host</span>}
        </div>

        {!isCurrentUser && onStartDM && (
          <button
            onClick={() => {
              onStartDM(participant);
            }}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            title={`Message ${participant.display_name}`}
          >
            <MessageCircle className="h-4 w-4" />
          </button>
        )}
      </div>

      {menuOpen && canModerate && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-44 rounded-md border border-border bg-background p-1 shadow-xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {participant.control_state === 'granted' ? (
            <button
              type="button"
              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onRevokeControl?.(participant);
                setMenuOpen(false);
              }}
            >
              Revoke control
            </button>
          ) : (
            <button
              type="button"
              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onGrantControl?.(participant);
                setMenuOpen(false);
              }}
            >
              Grant control
            </button>
          )}
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              onMuteParticipant?.(participant, !isMuted);
              setMenuOpen(false);
            }}
          >
            {isMuted ? 'Unmute participant' : 'Mute participant'}
          </button>
          <button
            type="button"
            className="block w-full rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={() => {
              onKickParticipant?.(participant);
              setMenuOpen(false);
            }}
          >
            Remove participant
          </button>
        </div>
      )}
    </>
  );
});
