import { execFileSync } from 'child_process';
import * as dbusNext from 'dbus-next';
import { resolveKey } from '../keymap.js';
import { ScrollAccumulator } from '../scroll.js';
import { detectWaylandScreenSize, type ScreenSize } from '../wayland/screenSize.js';
import type {
  CaptureBounds,
  InputBackend,
  InputBackendInitResult,
  InputEvent,
  KeyboardInputEvent,
  MouseButton,
  MouseButtonEvent,
  MouseMoveEvent,
  MouseScrollEvent,
} from '../types.js';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const REMOTE_DESKTOP = 'org.freedesktop.portal.RemoteDesktop';
const REQUEST = 'org.freedesktop.portal.Request';
const SESSION = 'org.freedesktop.portal.Session';
const POINTER = 2;
const KEYBOARD = 1;
const REQUIRED_DEVICES = POINTER | KEYBOARD;
const RESPONSE_OK = 0;

export interface WaylandPortalProbe {
  hasDbusSession: boolean;
  hasGdbus: boolean;
  portalDesktopAvailable: boolean;
  portalDesktopOwned?: boolean;
  portalDesktopName?: string;
  portalImplDetected?: string;
  currentDesktop?: string;
  error?: string;
}

interface PortalGrant {
  devices: number;
}

interface PendingPortalResponse {
  promise: Promise<Record<string, unknown>>;
  cancel: () => void;
}

interface RemoteDesktopInterface {
  CreateSession(options: Record<string, unknown>): Promise<unknown>;
  SelectDevices(session: string, options: Record<string, unknown>): Promise<unknown>;
  Start(session: string, parentWindow: string, options: Record<string, unknown>): Promise<unknown>;
  NotifyPointerMotion(
    session: string,
    options: Record<string, unknown>,
    dx: number,
    dy: number
  ): Promise<void>;
  NotifyPointerButton(
    session: string,
    options: Record<string, unknown>,
    button: number,
    state: number
  ): Promise<void>;
  NotifyPointerAxisDiscrete(
    session: string,
    options: Record<string, unknown>,
    axis: number,
    steps: number
  ): Promise<void>;
  NotifyKeyboardKeycode(
    session: string,
    options: Record<string, unknown>,
    keycode: number,
    state: number
  ): Promise<void>;
}

/** Compositor-approved input transport. Kept injectable for backend tests. */
export interface RemoteDesktopPortal {
  start(): Promise<PortalGrant>;
  pointerMotion(dx: number, dy: number): Promise<void>;
  pointerButton(button: number, pressed: boolean): Promise<void>;
  pointerAxisDiscrete(axis: 0 | 1, steps: number): Promise<void>;
  keyboardKeycode(keycode: number, pressed: boolean): Promise<void>;
  close(): Promise<void>;
}

type NameHasOwnerRunner = (busName: string) => boolean;
type ScreenSizeDetector = () => Promise<ScreenSize | null>;

function hasGdbusBinary(): boolean {
  try {
    execFileSync('gdbus', ['help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function defaultNameHasOwner(busName: string): boolean {
  const output = execFileSync(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.NameHasOwner',
      busName,
    ],
    { encoding: 'utf8', timeout: 1500 }
  );

  return /\btrue\b/i.test(output);
}

export function probeWaylandPortalSupport(
  nameHasOwner: NameHasOwnerRunner = defaultNameHasOwner
): WaylandPortalProbe {
  const currentDesktop =
    process.env.XDG_CURRENT_DESKTOP ??
    process.env.DESKTOP_SESSION ??
    process.env.GDMSESSION ??
    'unknown';
  const hasDbusSession = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
  const hasGdbus = hasGdbusBinary();

  const probe: WaylandPortalProbe = {
    hasDbusSession,
    hasGdbus,
    portalDesktopAvailable: false,
    currentDesktop,
  };

  if (!hasDbusSession) {
    probe.error = 'DBUS_SESSION_BUS_ADDRESS is not set';
    return probe;
  }

  if (!hasGdbus) {
    probe.error = '`gdbus` is required to probe xdg-desktop-portal';
    return probe;
  }

  try {
    const portalDesktopOwned = nameHasOwner(PORTAL_NAME);
    probe.portalDesktopOwned = portalDesktopOwned;
    probe.portalDesktopName = PORTAL_NAME;
    probe.portalDesktopAvailable = portalDesktopOwned;

    for (const candidate of [
      'org.freedesktop.impl.portal.desktop.kde',
      'org.freedesktop.impl.portal.desktop.gnome',
      'org.freedesktop.impl.portal.desktop.wlr',
      'org.freedesktop.impl.portal.desktop.hyprland',
    ]) {
      if (nameHasOwner(candidate)) {
        probe.portalImplDetected = candidate;
        break;
      }
    }

    if (!probe.portalDesktopAvailable) {
      probe.error = 'xdg-desktop-portal (org.freedesktop.portal.Desktop) is not running';
    }
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
  }

  return probe;
}

function unwrap(value: unknown): unknown {
  if (value instanceof dbusNext.Variant) return unwrap(value.value);
  return value;
}

function responseValue(results: Record<string, unknown>, key: string): unknown {
  return unwrap(results[key]);
}

function asSingleValue(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function makeToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Direct XDG RemoteDesktop client for Electron's main process.
 *
 * The portal, and therefore KWin, owns the authorization and injection path.
 * This deliberately does not open /dev/uinput or depend on ydotoold.
 */
export class DbusRemoteDesktopPortal implements RemoteDesktopPortal {
  private bus: dbusNext.MessageBus | null = null;
  private remoteDesktop: RemoteDesktopInterface | null = null;
  private sessionHandle: string | null = null;

  private async getBus(): Promise<dbusNext.MessageBus> {
    if (this.bus) return this.bus;

    const bus = dbusNext.sessionBus();
    // `error` is special on Node EventEmitters: without a persistent listener
    // a portal/bus failure after connecting would terminate the host process.
    bus.on('error', (error) => {
      console.warn('[RemoteInput] Session DBus error', error);
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out connecting to the session DBus'));
      }, 5000);
      bus.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      bus.once('error', (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    this.bus = bus;
    return bus;
  }

  private async getRemoteDesktop(): Promise<RemoteDesktopInterface> {
    if (this.remoteDesktop) return this.remoteDesktop;
    const bus = await this.getBus();
    const object = await bus.getProxyObject(PORTAL_NAME, PORTAL_PATH);
    this.remoteDesktop = object.getInterface(REMOTE_DESKTOP) as unknown as RemoteDesktopInterface;
    return this.remoteDesktop;
  }

  private requestPath(token: string): string {
    const name = (this.bus as unknown as { name?: string } | null)?.name;
    if (!name) throw new Error('The session DBus connection has no unique name');
    return `${PORTAL_PATH}/request/${name.slice(1).replaceAll('.', '_')}/${token}`;
  }

  private waitForResponse(path: string): PendingPortalResponse {
    const bus = this.bus;
    if (!bus) {
      return {
        promise: Promise.reject(new Error('Session DBus is not connected')),
        cancel: () => undefined,
      };
    }

    let cancel = (): void => undefined;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        bus.removeListener('message', onMessage);
        reject(new Error('Timed out waiting for the desktop portal response'));
      }, 30_000);

      cancel = (): void => {
        clearTimeout(timeout);
        bus.removeListener('message', onMessage);
        reject(new Error('Desktop portal request was superseded'));
      };

      const onMessage = (message: dbusNext.Message): void => {
        if (message.path !== path || message.interface !== REQUEST || message.member !== 'Response')
          return;
        clearTimeout(timeout);
        bus.removeListener('message', onMessage);
        const body: unknown = message.body;
        if (!Array.isArray(body)) {
          reject(new Error('Desktop portal returned an invalid response'));
          return;
        }
        const code: unknown = body[0];
        const results: unknown = body[1];
        if (code !== RESPONSE_OK) {
          reject(new Error(`Desktop portal request was denied (response ${String(code)})`));
          return;
        }
        resolve(asRecord(results));
      };

      bus.on('message', onMessage);
    });
    return { promise, cancel };
  }

  private async request(
    token: string,
    invoke: () => Promise<unknown>
  ): Promise<Record<string, unknown>> {
    const expectedPath = this.requestPath(token);
    let response = this.waitForResponse(expectedPath);
    // Mark this promise handled before invoking. If the method itself fails or
    // returns a malformed path, the portal's later timeout must not surface as
    // an unrelated unhandled rejection.
    void response.promise.catch(() => undefined);
    let returnedPath: string;
    try {
      returnedPath = String(asSingleValue(await invoke()));
    } catch (error) {
      response.cancel();
      throw error;
    }
    if (returnedPath !== expectedPath) {
      // Older portal versions may choose a different request path. The portal
      // specification explicitly recommends updating the signal subscription
      // in that case; retain the pre-call subscription for modern portals to
      // avoid the response race entirely.
      response.cancel();
      response = this.waitForResponse(returnedPath);
      void response.promise.catch(() => undefined);
    }
    return response.promise;
  }

  async start(): Promise<PortalGrant> {
    if (this.sessionHandle) return { devices: REQUIRED_DEVICES };

    const portal = await this.getRemoteDesktop();
    const createToken = makeToken('pairux_create');
    const sessionToken = makeToken('pairux_session');
    const create = await this.request(createToken, () =>
      portal.CreateSession({
        handle_token: new dbusNext.Variant('s', createToken),
        session_handle_token: new dbusNext.Variant('s', sessionToken),
      })
    );
    const sessionHandle = String(responseValue(create, 'session_handle'));

    const devicesToken = makeToken('pairux_devices');
    await this.request(devicesToken, () =>
      portal.SelectDevices(sessionHandle, {
        handle_token: new dbusNext.Variant('s', devicesToken),
        types: new dbusNext.Variant('u', REQUIRED_DEVICES),
      })
    );

    const startToken = makeToken('pairux_start');
    const started = await this.request(startToken, () =>
      portal.Start(sessionHandle, '', {
        handle_token: new dbusNext.Variant('s', startToken),
      })
    );
    const devices = Number(responseValue(started, 'devices') ?? 0);
    if ((devices & REQUIRED_DEVICES) !== REQUIRED_DEVICES) {
      await this.closeSession(sessionHandle);
      throw new Error('The desktop portal did not grant keyboard and pointer control');
    }

    this.sessionHandle = sessionHandle;
    return { devices };
  }

  private session(): string {
    if (!this.sessionHandle) throw new Error('Desktop portal input is not authorized');
    return this.sessionHandle;
  }

  async pointerMotion(dx: number, dy: number): Promise<void> {
    const portal = await this.getRemoteDesktop();
    await portal.NotifyPointerMotion(this.session(), {}, dx, dy);
  }

  async pointerButton(button: number, pressed: boolean): Promise<void> {
    const portal = await this.getRemoteDesktop();
    await portal.NotifyPointerButton(this.session(), {}, button, pressed ? 1 : 0);
  }

  async pointerAxisDiscrete(axis: 0 | 1, steps: number): Promise<void> {
    if (steps === 0) return;
    const portal = await this.getRemoteDesktop();
    await portal.NotifyPointerAxisDiscrete(this.session(), {}, axis, steps);
  }

  async keyboardKeycode(keycode: number, pressed: boolean): Promise<void> {
    const portal = await this.getRemoteDesktop();
    await portal.NotifyKeyboardKeycode(this.session(), {}, keycode, pressed ? 1 : 0);
  }

  private async closeSession(handle: string): Promise<void> {
    const bus = await this.getBus();
    const object = await bus.getProxyObject(PORTAL_NAME, handle);
    await (object.getInterface(SESSION) as unknown as { Close: () => Promise<void> }).Close();
  }

  async close(): Promise<void> {
    const handle = this.sessionHandle;
    this.sessionHandle = null;
    this.remoteDesktop = null;
    try {
      if (handle) await this.closeSession(handle);
    } finally {
      this.bus?.disconnect();
      this.bus = null;
    }
  }
}

function portalButton(button: MouseButton): number {
  switch (button) {
    case 'right':
      return 273; // BTN_RIGHT
    case 'middle':
      return 274; // BTN_MIDDLE
    case 'left':
    default:
      return 272; // BTN_LEFT
  }
}

const KEYCODES: Record<string, number> = {
  Escape: 1,
  Digit1: 2,
  Digit2: 3,
  Digit3: 4,
  Digit4: 5,
  Digit5: 6,
  Digit6: 7,
  Digit7: 8,
  Digit8: 9,
  Digit9: 10,
  Digit0: 11,
  Minus: 12,
  Equal: 13,
  Backspace: 14,
  Tab: 15,
  KeyQ: 16,
  KeyW: 17,
  KeyE: 18,
  KeyR: 19,
  KeyT: 20,
  KeyY: 21,
  KeyU: 22,
  KeyI: 23,
  KeyO: 24,
  KeyP: 25,
  BracketLeft: 26,
  BracketRight: 27,
  Enter: 28,
  ControlLeft: 29,
  KeyA: 30,
  KeyS: 31,
  KeyD: 32,
  KeyF: 33,
  KeyG: 34,
  KeyH: 35,
  KeyJ: 36,
  KeyK: 37,
  KeyL: 38,
  Semicolon: 39,
  Quote: 40,
  Backquote: 41,
  ShiftLeft: 42,
  Backslash: 43,
  KeyZ: 44,
  KeyX: 45,
  KeyC: 46,
  KeyV: 47,
  KeyB: 48,
  KeyN: 49,
  KeyM: 50,
  Comma: 51,
  Period: 52,
  Slash: 53,
  ShiftRight: 54,
  AltLeft: 56,
  Space: 57,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
  ControlRight: 97,
  AltRight: 100,
  Home: 102,
  ArrowUp: 103,
  PageUp: 104,
  ArrowLeft: 105,
  ArrowRight: 106,
  End: 107,
  ArrowDown: 108,
  PageDown: 109,
  Insert: 110,
  Delete: 111,
  MetaLeft: 125,
  MetaRight: 126,
};

function keycode(event: KeyboardInputEvent): number | null {
  const resolved = resolveKey(event, 'linux');
  if (!resolved || resolved.kind === 'text') return KEYCODES[event.code] ?? null;
  return KEYCODES[resolved.code] ?? null;
}

export class WaylandPortalInputBackend implements InputBackend {
  readonly name = 'wayland-portal';
  supported: boolean;
  reason: string | undefined;
  details: Record<string, unknown>;
  private screenWidth = 1920;
  private screenHeight = 1080;
  private captureBounds: CaptureBounds | null = null;
  private readonly portal: RemoteDesktopPortal;
  private readonly detectScreenSize: ScreenSizeDetector;
  private active = false;
  private lastPosition = { x: 0.5, y: 0.5 };
  private readonly heldButtons = new Set<number>();
  private readonly heldKeys = new Set<number>();
  private readonly scrollX = new ScrollAccumulator();
  private readonly scrollY = new ScrollAccumulator();

  constructor(
    probe: WaylandPortalProbe = probeWaylandPortalSupport(),
    portal: RemoteDesktopPortal = new DbusRemoteDesktopPortal(),
    detectScreenSize: ScreenSizeDetector = detectWaylandScreenSize
  ) {
    this.portal = portal;
    this.detectScreenSize = detectScreenSize;
    this.supported = probe.hasDbusSession && probe.portalDesktopAvailable;
    this.details = {
      hasDbusSession: probe.hasDbusSession,
      hasGdbus: probe.hasGdbus,
      portalDesktopAvailable: probe.portalDesktopAvailable,
      portalDesktopOwned: probe.portalDesktopOwned,
      portalDesktopName: probe.portalDesktopName,
      portalImplDetected: probe.portalImplDetected ?? null,
      currentDesktop: probe.currentDesktop,
      probeError: probe.error,
      portalSessionActive: false,
      implemented: true,
    };

    if (!probe.hasDbusSession) {
      this.reason = 'Wayland portal input requires a DBus session.';
    } else if (!probe.portalDesktopAvailable) {
      this.reason = 'Wayland portal input requires xdg-desktop-portal to be running.';
    }
  }

  async init(): Promise<InputBackendInitResult | undefined> {
    if (!this.supported) return undefined;
    const size = await this.detectScreenSize().catch(() => null);
    if (size) {
      this.screenWidth = size.width;
      this.screenHeight = size.height;
    }
    return { screenWidth: this.screenWidth, screenHeight: this.screenHeight };
  }

  async activate(): Promise<void> {
    if (!this.supported) throw new Error(this.reason ?? 'Wayland portal input is unavailable');
    if (this.active) return;
    try {
      const grant = await this.portal.start();
      if ((grant.devices & REQUIRED_DEVICES) !== REQUIRED_DEVICES) {
        throw new Error('KDE did not grant pointer and keyboard control');
      }
      this.active = true;
      this.lastPosition = { x: 0.5, y: 0.5 };
      this.reason = undefined;
      this.details = { ...this.details, portalSessionActive: true, portalDevices: grant.devices };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reason = `KDE Remote Desktop permission was not granted: ${message}`;
      this.details = { ...this.details, portalSessionActive: false, portalError: message };
      await this.portal.close().catch(() => undefined);
      throw error;
    }
  }

  updateScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  updateCaptureBounds(bounds: CaptureBounds | null): void {
    this.captureBounds = bounds;
  }

  private surface(): CaptureBounds {
    return this.captureBounds ?? { x: 0, y: 0, width: this.screenWidth, height: this.screenHeight };
  }

  /**
   * Bring the compositor's shared pointer forward to a guest position.
   *
   * The RemoteDesktop portal only accepts relative pointer input unless a
   * matching ScreenCast stream has also been selected. PairUX intentionally
   * does not open a second source-picker here, so the viewer's pointer-lock
   * position is converted into successive relative vectors. Button and wheel
   * events carry a position too; applying it first prevents a first click from
   * landing at the host's stale physical cursor.
   */
  private async moveTo(event: Pick<MouseMoveEvent, 'x' | 'y'>): Promise<void> {
    const { width, height } = this.surface();
    const dx = Math.round((event.x - this.lastPosition.x) * width);
    const dy = Math.round((event.y - this.lastPosition.y) * height);
    this.lastPosition = { x: event.x, y: event.y };
    if (dx !== 0 || dy !== 0) await this.portal.pointerMotion(dx, dy);
  }

  private async mouseButton(event: MouseButtonEvent): Promise<void> {
    await this.moveTo(event);
    const button = portalButton(event.button);
    if (event.action === 'click' || event.action === 'dblclick') {
      const clicks = event.action === 'dblclick' ? 2 : 1;
      for (let i = 0; i < clicks; i += 1) {
        await this.portal.pointerButton(button, true);
        await this.portal.pointerButton(button, false);
      }
      return;
    }
    const pressed = event.action === 'down';
    await this.portal.pointerButton(button, pressed);
    if (pressed) this.heldButtons.add(button);
    else this.heldButtons.delete(button);
  }

  private async scroll(event: MouseScrollEvent): Promise<void> {
    await this.moveTo(event);
    const vertical = this.scrollY.add(event.deltaY, event.deltaMode);
    const horizontal = this.scrollX.add(event.deltaX, event.deltaMode);
    await this.portal.pointerAxisDiscrete(0, vertical);
    await this.portal.pointerAxisDiscrete(1, horizontal);
  }

  private async keyboard(event: KeyboardInputEvent): Promise<void> {
    const code = keycode(event);
    if (code == null) throw new Error(`Unsupported key for KDE portal backend: ${event.code}`);
    if (event.action === 'press') {
      await this.portal.keyboardKeycode(code, true);
      await this.portal.keyboardKeycode(code, false);
      return;
    }
    const pressed = event.action === 'down';
    await this.portal.keyboardKeycode(code, pressed);
    if (pressed) this.heldKeys.add(code);
    else this.heldKeys.delete(code);
  }

  async inject(event: InputEvent): Promise<void> {
    if (!this.active) throw new Error('KDE portal control has not been authorized');
    if (event.type === 'keyboard') return this.keyboard(event);
    if (event.action === 'move') return this.moveTo(event);
    if (event.action === 'scroll') return this.scroll(event);
    return this.mouseButton(event);
  }

  async emergencyStop(): Promise<void> {
    if (!this.active) return;
    for (const button of this.heldButtons) await this.portal.pointerButton(button, false);
    for (const key of this.heldKeys) await this.portal.keyboardKeycode(key, false);
    this.heldButtons.clear();
    this.heldKeys.clear();
    this.scrollX.reset();
    this.scrollY.reset();
  }

  async deactivate(): Promise<void> {
    await this.emergencyStop();
    await this.portal.close();
    this.active = false;
    this.lastPosition = { x: 0.5, y: 0.5 };
    this.details = { ...this.details, portalSessionActive: false };
  }

  async dispose(): Promise<void> {
    await this.deactivate();
  }
}
