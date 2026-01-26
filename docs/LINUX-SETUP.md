# Linux Setup Guide for PairUX

This guide covers Linux-specific setup, permissions, and troubleshooting for PairUX.

## System Requirements

- Ubuntu 22.04+, Fedora 38+, Debian 12+, or Arch Linux
- X11 or Wayland (with PipeWire) display server
- 4GB RAM minimum (8GB recommended)
- PipeWire (required for Wayland screen capture)

## Installation

### Ubuntu/Debian (APT)

```bash
# Add PairUX repository
curl -fsSL https://pairux.com/linux/gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/pairux-archive-keyring.gpg] https://pairux.com/linux/apt stable main" | sudo tee /etc/apt/sources.list.d/pairux.list

# Install PairUX
sudo apt update
sudo apt install pairux
```

### Fedora/RHEL (DNF)

```bash
# Add PairUX repository
sudo dnf config-manager --add-repo https://pairux.com/linux/rpm/pairux.repo

# Install PairUX
sudo dnf install pairux
```

### Arch Linux (AUR)

```bash
# Using yay
yay -S pairux

# Or using paru
paru -S pairux
```

### AppImage (Universal)

```bash
# Download AppImage
wget https://github.com/pairux/pairux/releases/latest/download/PairUX-linux-x86_64.AppImage

# Make executable
chmod +x PairUX-linux-x86_64.AppImage

# Run
./PairUX-linux-x86_64.AppImage
```

## Display Server Detection

PairUX automatically detects your display server:

### Check Your Display Server

```bash
echo $XDG_SESSION_TYPE
# Output: x11 or wayland
```

Or:

```bash
loginctl show-session $(loginctl | grep $(whoami) | awk '{print $1}') -p Type
```

## X11 Configuration

X11 is fully supported with the following features:

- ✅ Screen capture (via XSHM/XComposite)
- ✅ Window capture
- ✅ Input injection (via XTEST extension)
- ✅ Multi-monitor support

### Required Packages (X11)

Most distributions include these by default:

```bash
# Ubuntu/Debian
sudo apt install libxss1 libxtst6

# Fedora
sudo dnf install libXScrnSaver libXtst

# Arch
sudo pacman -S libxss libxtst
```

### Verify XTEST Extension

The XTEST extension is required for remote control. To verify it's available:

```bash
xdpyinfo | grep -i xtest
```

You should see output like:

```
XTEST
```

### Sandbox Configuration (X11)

If you encounter sandbox errors, you may need to disable the SUID sandbox:

```bash
# Option 1: Run with --no-sandbox
pairux --no-sandbox

# Option 2: Set environment variable
export ELECTRON_DISABLE_SANDBOX=1
pairux
```

For persistent configuration, add to your `.bashrc` or `.zshrc`:

```bash
alias pairux='pairux --no-sandbox'
```

## Wayland Configuration

Wayland support requires PipeWire for screen capture. Input injection has **limited support** on Wayland due to security restrictions.

### Current Wayland Limitations

- ⚠️ Screen capture requires PipeWire
- ⚠️ Input injection has very limited support
- ⚠️ Some compositors may not support all features
- ✅ Screen sharing via xdg-desktop-portal works

### Required Packages (Wayland)

```bash
# Ubuntu/Debian (22.04+)
sudo apt install pipewire pipewire-audio-client-libraries xdg-desktop-portal-gtk

# Fedora (uses PipeWire by default)
sudo dnf install pipewire xdg-desktop-portal-gtk

# Arch
sudo pacman -S pipewire xdg-desktop-portal xdg-desktop-portal-gtk
```

### Verify PipeWire

```bash
# Check if PipeWire is running
systemctl --user status pipewire

# Check PipeWire version
pipewire --version
```

### Enable PipeWire Screen Capture

PipeWire screen capture should work automatically. If not:

```bash
# Ensure xdg-desktop-portal is running
systemctl --user start xdg-desktop-portal

# Enable at startup
systemctl --user enable xdg-desktop-portal
```

### GNOME on Wayland

GNOME works well with PairUX. Ensure these portals are installed:

```bash
sudo apt install xdg-desktop-portal-gnome  # Ubuntu/Debian
sudo dnf install xdg-desktop-portal-gnome  # Fedora
```

### KDE on Wayland

For KDE Plasma on Wayland:

```bash
sudo apt install xdg-desktop-portal-kde  # Ubuntu/Debian
sudo dnf install xdg-desktop-portal-kde  # Fedora
```

### Sway/wlroots Compositors

For wlroots-based compositors (Sway, etc.):

```bash
sudo apt install xdg-desktop-portal-wlr  # Ubuntu/Debian
paru -S xdg-desktop-portal-wlr  # Arch
```

## Input Injection Permissions

### X11 Input Injection

On X11, input injection uses the XTEST extension which doesn't require special permissions.

However, some applications may ignore simulated input:

- Games with anti-cheat
- Applications using raw input
- Privileged applications

### Wayland Input Injection (Limited)

Wayland's security model restricts input injection. Current status:

| Compositor | Input Support                    |
| ---------- | -------------------------------- |
| GNOME      | ❌ No (security restriction)     |
| KDE        | ⚠️ Limited (experimental)        |
| Sway       | ⚠️ Limited (wlr-virtual-pointer) |
| Weston     | ❌ No                            |

**Recommendation**: For full remote control functionality, use X11 or Xwayland.

### Using Xwayland for Remote Control

You can run PairUX under Xwayland for input support:

```bash
# Force X11 mode
GDK_BACKEND=x11 pairux

# Or set DISPLAY explicitly
DISPLAY=:0 pairux
```

## Troubleshooting

### Screen Capture Not Working

**X11:**

```bash
# Check permissions
xhost +local:

# Verify DISPLAY is set
echo $DISPLAY

# Test with simple capture
scrot test.png
```

**Wayland:**

```bash
# Check PipeWire
systemctl --user status pipewire

# Check portal
systemctl --user status xdg-desktop-portal

# View portal logs
journalctl --user -u xdg-desktop-portal -f
```

### "GPU process isn't usable" Error

Install Vulkan drivers:

```bash
# Ubuntu/Debian (NVIDIA)
sudo apt install nvidia-driver-xxx vulkan-utils

# Ubuntu/Debian (AMD/Intel)
sudo apt install mesa-vulkan-drivers vulkan-tools

# Fedora (AMD/Intel)
sudo dnf install mesa-vulkan-drivers vulkan-tools
```

Or run without GPU acceleration:

```bash
pairux --disable-gpu
```

### Sandbox Errors

```bash
# Error: "The SUID sandbox helper binary was found..."

# Option 1: Set proper permissions (requires root)
sudo chown root:root /path/to/chrome-sandbox
sudo chmod 4755 /path/to/chrome-sandbox

# Option 2: Disable sandbox (development only)
pairux --no-sandbox
```

### No Audio in Recording

Install audio libraries:

```bash
# Ubuntu/Debian
sudo apt install libasound2-plugins libpulse0

# Fedora
sudo dnf install alsa-plugins-pulseaudio pulseaudio-libs
```

### Application Won't Start

Check for missing dependencies:

```bash
# Find missing libraries
ldd /opt/pairux/pairux | grep "not found"

# Common missing libraries
sudo apt install libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
  libgtk-3-0 libnspr4 libnss3 libxcomposite1 libxdamage1 libxrandr2
```

### Permission Denied on Launch

```bash
# Make sure the executable is runnable
chmod +x /opt/pairux/pairux

# Check AppArmor (Ubuntu)
sudo aa-status

# Check SELinux (Fedora)
getenforce
```

## Environment Variables

Configure PairUX behavior with environment variables:

```bash
# Force X11 backend (for Wayland users who want input support)
GDK_BACKEND=x11 pairux

# Enable verbose logging
ELECTRON_ENABLE_LOGGING=1 pairux

# Disable hardware acceleration
LIBGL_ALWAYS_SOFTWARE=1 pairux

# Wayland-specific
XDG_SESSION_TYPE=wayland pairux
```

## Flatpak/Snap Notes

### Flatpak

If using Flatpak, grant necessary permissions:

```bash
flatpak override --user --socket=wayland com.pairux.PairUX
flatpak override --user --socket=x11 com.pairux.PairUX
flatpak override --user --device=dri com.pairux.PairUX
```

### Snap

Snap packages may have additional confinement. Check with:

```bash
snap connections pairux
```

## Getting Help

- [Documentation](https://pairux.com/docs)
- [GitHub Issues](https://github.com/pairux/pairux/issues)
- [Community Forum](https://pairux.com/community)
- IRC: #pairux on Libera.Chat
