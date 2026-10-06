/**
 * A drop-in call UI for a PairuxCall: participant tiles and controls, plain DOM
 * (no framework), themeable through CSS custom properties on the container:
 * --pxe-bg, --pxe-tile, --pxe-fg, --pxe-muted, --pxe-accent, --pxe-danger.
 *
 *   const ui = mountCall(document.getElementById('call'), call, { onLeave });
 *   ...
 *   ui.destroy();
 */
import type { CallParticipant, CallTrack, PairuxCall } from './call.js';

export interface WidgetOptions {
  onLeave?: () => void;
  /** Words on the controls, for translation. */
  labels?: Partial<typeof LABELS>;
}

const LABELS = {
  mute: 'Mute',
  unmute: 'Unmute',
  cameraOn: 'Start video',
  cameraOff: 'Stop video',
  shareOn: 'Share screen',
  shareOff: 'Stop sharing',
  leave: 'Leave',
  encrypted: 'End-to-end encrypted',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
};

const CSS = `
.pxe { display: flex; flex-direction: column; gap: .75rem; height: 100%; min-height: 240px; padding: .75rem; box-sizing: border-box; background: var(--pxe-bg, #0b0d12); color: var(--pxe-fg, #e6e8ee); font: 14px system-ui, sans-serif; border-radius: 12px; }
.pxe-status { font-size: 12px; color: var(--pxe-muted, #8a90a0); display: flex; gap: .5rem; align-items: center; }
.pxe-grid { flex: 1; display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); grid-auto-rows: minmax(120px, 1fr); }
.pxe-tile { position: relative; overflow: hidden; border-radius: 10px; background: var(--pxe-tile, #161a23); display: flex; align-items: center; justify-content: center; outline: 2px solid transparent; transition: outline-color .15s; }
.pxe-tile.speaking { outline-color: var(--pxe-accent, #3b82f6); }
.pxe-tile video { width: 100%; height: 100%; object-fit: cover; background: #000; }
.pxe-tile.screen video { object-fit: contain; }
.pxe-avatar { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 22px; background: var(--pxe-accent, #3b82f6); color: #fff; }
.pxe-name { position: absolute; left: 8px; bottom: 8px; padding: 2px 8px; border-radius: 6px; background: rgba(0,0,0,.55); font-size: 12px; display: flex; gap: 6px; align-items: center; }
.pxe-controls { display: flex; justify-content: center; gap: .5rem; flex-wrap: wrap; }
.pxe-btn { border: 1px solid rgba(255,255,255,.15); background: var(--pxe-tile, #161a23); color: inherit; padding: .5rem .9rem; border-radius: 999px; cursor: pointer; font: inherit; }
.pxe-btn.on { background: var(--pxe-accent, #3b82f6); border-color: transparent; color: #fff; }
.pxe-btn.leave { background: var(--pxe-danger, #dc2626); border-color: transparent; color: #fff; }
.pxe-btn:disabled { opacity: .5; cursor: not-allowed; }
`;

function injectCss(doc: Document) {
  if (doc.getElementById('pairux-embed-css')) return;
  const style = doc.createElement('style');
  style.id = 'pairux-embed-css';
  style.textContent = CSS;
  doc.head.appendChild(style);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export function mountCall(container: HTMLElement, call: PairuxCall, options: WidgetOptions = {}) {
  const doc = container.ownerDocument;
  const L = { ...LABELS, ...options.labels };
  injectCss(doc);

  const root = doc.createElement('div');
  root.className = 'pxe';
  const status = doc.createElement('div');
  status.className = 'pxe-status';
  const grid = doc.createElement('div');
  grid.className = 'pxe-grid';
  const controls = doc.createElement('div');
  controls.className = 'pxe-controls';
  const audioSink = doc.createElement('div');
  audioSink.hidden = true;
  root.append(status, grid, controls, audioSink);
  container.replaceChildren(root);

  const button = (label: string, onClick: () => Promise<void> | void, extra = '') => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `pxe-btn ${extra}`.trim();
    b.textContent = label;
    b.addEventListener('click', () => {
      void run();
    });
    const run = async () => {
      b.disabled = true;
      try {
        await onClick();
      } finally {
        b.disabled = false;
      }
    };
    return b;
  };

  let me: CallParticipant | undefined;
  const micBtn = button(L.mute, () => call.setMic(!me?.micOn));
  const camBtn = button(L.cameraOn, () => call.setCamera(!me?.cameraOn));
  const shareBtn = button(L.shareOn, () => call.setScreen(!me?.screenOn));
  const leaveBtn = button(
    L.leave,
    async () => {
      await call.leave();
      options.onLeave?.();
    },
    'leave'
  );
  controls.append(micBtn, camBtn, shareBtn, leaveBtn);

  const detachers = new Map<string, () => void>();

  function renderStatus() {
    const everyoneEncrypted = me ? call.participants().every((p) => p.encrypted) : false;
    status.textContent =
      call.state === 'connecting'
        ? L.connecting
        : call.state === 'reconnecting'
          ? L.reconnecting
          : everyoneEncrypted
            ? `🔒 ${L.encrypted}`
            : '';
  }

  function render(list: CallParticipant[] = call.participants()) {
    me = list.find((p) => p.isLocal);
    micBtn.textContent = me?.micOn ? L.mute : L.unmute;
    micBtn.classList.toggle('on', !!me?.micOn);
    camBtn.textContent = me?.cameraOn ? L.cameraOff : L.cameraOn;
    camBtn.classList.toggle('on', !!me?.cameraOn);
    shareBtn.textContent = me?.screenOn ? L.shareOff : L.shareOn;
    shareBtn.classList.toggle('on', !!me?.screenOn);

    for (const d of detachers.values()) d();
    detachers.clear();
    grid.replaceChildren(
      ...list.map((p) => {
        const tile = doc.createElement('div');
        tile.className = `pxe-tile${p.speaking ? ' speaking' : ''}${p.screenOn ? ' screen' : ''}`;
        tile.dataset.participant = p.id;
        if (p.screenOn || p.cameraOn) {
          const video = doc.createElement('video');
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true; // audio plays through the hidden sink, once
          tile.append(video);
          detachers.set(p.id, call.attachVideo(p.id, video, p.screenOn ? 'screen' : 'camera'));
        } else {
          const avatar = doc.createElement('div');
          avatar.className = 'pxe-avatar';
          avatar.textContent = initials(p.name);
          tile.append(avatar);
        }
        const name = doc.createElement('div');
        name.className = 'pxe-name';
        name.textContent = `${p.encrypted ? '🔒 ' : ''}${p.name}${p.isLocal ? ' (you)' : ''}${p.micOn ? '' : ' 🔇'}`;
        tile.append(name);
        return tile;
      })
    );
    renderStatus();
  }

  const onParticipants = (e: Event) => {
    render((e as CustomEvent<CallParticipant[]>).detail);
  };
  const onState = () => {
    renderStatus();
  };
  const onTrack = (e: Event) => {
    const t = (e as CustomEvent<CallTrack>).detail;
    if (t.kind !== 'audio') {
      render();
      return;
    }
    const el = doc.createElement('audio');
    el.autoplay = true;
    audioSink.append(el);
    t.attach(el);
  };
  call.addEventListener('participants', onParticipants);
  call.addEventListener('state', onState);
  call.addEventListener('track', onTrack);
  render();

  return {
    root,
    destroy() {
      call.removeEventListener('participants', onParticipants);
      call.removeEventListener('state', onState);
      call.removeEventListener('track', onTrack);
      for (const d of detachers.values()) d();
      container.replaceChildren();
    },
  };
}
