// PairUX's Wayland portal client always uses DBUS_SESSION_BUS_ADDRESS.
// dbus-next only touches its optional X11 fallback when that variable is
// absent, so intentionally expose no X11 implementation in packaged builds.
export default null;
