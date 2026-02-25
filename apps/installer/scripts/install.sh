#!/bin/bash
# ===========================================
# PairUX Desktop App Installer
# ===========================================
# Usage: curl -fsSL https://installer.pairux.com/install.sh | bash
# ===========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="profullstack/pairux.com"
INSTALLER_URL="${PAIRUX_INSTALLER_URL:-https://installer.pairux.com}"
INSTALL_DIR="${PAIRUX_INSTALL_DIR:-$HOME/.pairux}"
BIN_DIR="${PAIRUX_BIN_DIR:-$HOME/.local/bin}"
APPLICATIONS_DIR="/Applications"

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "  ____       _      _   ___  __"
    echo " |  _ \ __ _(_)_ __| | | \ \/ /"
    echo " | |_) / _\` | | '__| | | |\  / "
    echo " |  __/ (_| | | |  | |_| |/  \ "
    echo " |_|   \__,_|_|_|   \___//_/\_\\"
    echo -e "${NC}"
    echo "  Desktop App Installer"
    echo ""
}

# Logging functions
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

is_tty() {
    [ -t 0 ] && [ -t 1 ]
}

warn_existing_launcher() {
    local launcher="$BIN_DIR/pairux"
    if [ -L "$launcher" ]; then
        local target
        target=$(readlink "$launcher" 2>/dev/null || echo "unknown")
        warn "Found legacy symlink launcher at $launcher -> $target"
        warn "Replacing it with the managed PairUX wrapper script"
    fi
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="linux";;
        Darwin*) os="darwin";;
        MINGW*|MSYS*|CYGWIN*) os="windows";;
        *)       error "Unsupported operating system: $(uname -s)";;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64";;
        arm64|aarch64) arch="arm64";;
        armv7l) arch="armv7l";;
        *)      error "Unsupported architecture: $(uname -m)";;
    esac

    echo "${os}-${arch}"
}

# Check dependencies
check_dependencies() {
    local missing=()

    if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
        missing+=("curl or wget")
    fi

    if ! command -v tar &> /dev/null; then
        missing+=("tar")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing[*]}"
    fi
}

detect_linux_package_manager() {
    if command -v apt-get &> /dev/null; then
        echo "apt"
    elif command -v dnf &> /dev/null; then
        echo "dnf"
    elif command -v yum &> /dev/null; then
        echo "yum"
    elif command -v zypper &> /dev/null; then
        echo "zypper"
    elif command -v pacman &> /dev/null; then
        echo "pacman"
    elif command -v emerge &> /dev/null; then
        echo "emerge"
    elif command -v nix &> /dev/null; then
        echo "nix"
    else
        echo "unknown"
    fi
}

apt_package_exists() {
    local pkg="$1"
    command -v apt-cache &> /dev/null && apt-cache show "$pkg" >/dev/null 2>&1
}

dnf_package_exists() {
    local pkg="$1"
    command -v dnf &> /dev/null && dnf info "$pkg" >/dev/null 2>&1
}

yum_package_exists() {
    local pkg="$1"
    command -v yum &> /dev/null && yum info "$pkg" >/dev/null 2>&1
}

zypper_package_exists() {
    local pkg="$1"
    command -v zypper &> /dev/null && zypper --non-interactive info "$pkg" >/dev/null 2>&1
}

pacman_package_exists() {
    local pkg="$1"
    command -v pacman &> /dev/null && pacman -Si "$pkg" >/dev/null 2>&1
}

detect_linux_desktop_family() {
    local desktop
    desktop=$(printf '%s %s %s' "${XDG_CURRENT_DESKTOP:-}" "${DESKTOP_SESSION:-}" "${GDMSESSION:-}" | tr '[:upper:]' '[:lower:]')

    case "$desktop" in
        *kde*|*plasma*)
            echo "kde"
            ;;
        *gnome*)
            echo "gnome"
            ;;
        *hyprland*|*hypr*)
            echo "hyprland"
            ;;
        *sway*|*wlroots*|*river*)
            echo "wlr"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

is_wayland_session() {
    [ "${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "${WAYLAND_DISPLAY:-}" ]
}

build_wayland_dep_packages() {
    local pm="$1"
    local desktop_family="$2"
    local packages=()

    case "$pm" in
        apt)
            packages+=(ydotool xdg-desktop-portal libglib2.0-bin)
            if apt_package_exists ydotoold; then
                packages+=(ydotoold)
            fi
            case "$desktop_family" in
                kde) packages+=(xdg-desktop-portal-kde) ;;
                gnome) packages+=(xdg-desktop-portal-gnome) ;;
                hyprland) packages+=(xdg-desktop-portal-hyprland) ;;
                wlr) packages+=(xdg-desktop-portal-wlr) ;;
                *) packages+=(xdg-desktop-portal-gtk) ;;
            esac
            ;;
        dnf|yum)
            packages+=(ydotool xdg-desktop-portal glib2)
            if { [ "$pm" = "dnf" ] && dnf_package_exists ydotoold; } || { [ "$pm" = "yum" ] && yum_package_exists ydotoold; }; then
                packages+=(ydotoold)
            fi
            case "$desktop_family" in
                kde) packages+=(xdg-desktop-portal-kde) ;;
                gnome) packages+=(xdg-desktop-portal-gnome) ;;
                hyprland) packages+=(xdg-desktop-portal-hyprland) ;;
                wlr) packages+=(xdg-desktop-portal-wlr) ;;
                *) packages+=(xdg-desktop-portal-gtk) ;;
            esac
            ;;
        zypper)
            packages+=(ydotool xdg-desktop-portal glib2-tools)
            if zypper_package_exists ydotoold; then
                packages+=(ydotoold)
            fi
            case "$desktop_family" in
                kde) packages+=(xdg-desktop-portal-kde) ;;
                gnome) packages+=(xdg-desktop-portal-gnome) ;;
                wlr) packages+=(xdg-desktop-portal-wlr) ;;
                *) packages+=(xdg-desktop-portal-gtk) ;;
            esac
            ;;
        pacman)
            packages+=(ydotool xdg-desktop-portal glib2)
            if pacman_package_exists ydotoold; then
                packages+=(ydotoold)
            fi
            case "$desktop_family" in
                kde) packages+=(xdg-desktop-portal-kde) ;;
                gnome) packages+=(xdg-desktop-portal-gnome) ;;
                hyprland) packages+=(xdg-desktop-portal-hyprland) ;;
                wlr) packages+=(xdg-desktop-portal-wlr) ;;
                *) packages+=(xdg-desktop-portal-gtk) ;;
            esac
            ;;
        emerge)
            packages+=(app-misc/ydotool sys-apps/xdg-desktop-portal dev-libs/glib)
            case "$desktop_family" in
                kde) packages+=(kde-plasma/xdg-desktop-portal-kde) ;;
                gnome) packages+=(gnome-extra/xdg-desktop-portal-gnome) ;;
                wlr|hyprland) packages+=(gui-libs/xdg-desktop-portal-wlr) ;;
            esac
            ;;
        nix)
            packages+=(nixpkgs#ydotool nixpkgs#xdg-desktop-portal nixpkgs#glib)
            case "$desktop_family" in
                kde) packages+=(nixpkgs#xdg-desktop-portal-kde) ;;
                gnome) packages+=(nixpkgs#xdg-desktop-portal-gnome) ;;
                hyprland) packages+=(nixpkgs#xdg-desktop-portal-hyprland) ;;
                wlr) packages+=(nixpkgs#xdg-desktop-portal-wlr) ;;
                *) packages+=(nixpkgs#xdg-desktop-portal-gtk) ;;
            esac
            ;;
    esac

    printf '%s\n' "${packages[@]}" | awk 'NF && !seen[$0]++'
}

build_wayland_dep_install_command() {
    local pm="$1"
    shift
    local pkgs=("$@")

    case "$pm" in
        apt)
            printf 'sudo apt-get update && sudo apt-get install -y %s' "${pkgs[*]}"
            ;;
        dnf)
            printf 'sudo dnf install -y %s' "${pkgs[*]}"
            ;;
        yum)
            printf 'sudo yum install -y %s' "${pkgs[*]}"
            ;;
        zypper)
            printf 'sudo zypper install -y %s' "${pkgs[*]}"
            ;;
        pacman)
            printf 'sudo pacman -Sy --needed %s' "${pkgs[*]}"
            ;;
        emerge)
            printf 'sudo emerge -av %s' "${pkgs[*]}"
            ;;
        nix)
            printf 'nix profile install %s' "${pkgs[*]}"
            ;;
        *)
            return 1
            ;;
    esac
}

run_linux_dependency_install() {
    local command_str="$1"

    if [[ "$command_str" == nix\ * ]]; then
        bash -lc "$command_str"
        return $?
    fi

    if [ "$(id -u)" -eq 0 ]; then
        local root_cmd="${command_str#sudo }"
        bash -lc "$root_cmd"
        return $?
    fi

    if command -v sudo &> /dev/null; then
        bash -lc "$command_str"
        return $?
    fi

    warn "sudo is not installed; cannot auto-install Linux dependencies."
    return 1
}

start_ydotool_daemon_if_available() {
    if ! command -v ydotoold &> /dev/null; then
        return 0
    fi

    if [ -S "${YDOTOOL_SOCKET:-}" ] || [ -S /run/ydotoold/socket ] || [ -S "/tmp/.ydotool_socket" ] || [ -n "${XDG_RUNTIME_DIR:-}" -a -S "${XDG_RUNTIME_DIR}/.ydotool_socket" ]; then
        info "ydotool socket already present; skipping daemon start"
        return 0
    fi

    if ! command -v systemctl &> /dev/null; then
        warn "ydotoold is installed, but systemctl is unavailable. Start it manually: sudo ydotoold"
        return 0
    fi

    local user_units=("ydotoold" "ydotool")
    local unit
    for unit in "${user_units[@]}"; do
        if systemctl --user list-unit-files "${unit}.service" >/dev/null 2>&1; then
            info "Attempting to enable/start user service ${unit}.service for Wayland input support..."
            systemctl --user enable --now "${unit}.service" >/dev/null 2>&1 || true
            break
        fi
    done

    if [ -S /run/ydotoold/socket ] || [ -S "/tmp/.ydotool_socket" ] || [ -n "${XDG_RUNTIME_DIR:-}" -a -S "${XDG_RUNTIME_DIR}/.ydotool_socket" ]; then
        success "ydotoold socket detected"
        return 0
    fi

    local units=("ydotoold" "ydotool")
    for unit in "${units[@]}"; do
        if systemctl list-unit-files "${unit}.service" >/dev/null 2>&1; then
            info "Attempting to enable/start ${unit}.service for Wayland input support..."
            if [ "$(id -u)" -eq 0 ]; then
                systemctl enable --now "${unit}.service" >/dev/null 2>&1 || true
            elif command -v sudo &> /dev/null; then
                sudo systemctl enable --now "${unit}.service" >/dev/null 2>&1 || true
            fi
            break
        fi
    done

    if [ -S /run/ydotoold/socket ] || [ -S "/tmp/.ydotool_socket" ] || [ -n "${XDG_RUNTIME_DIR:-}" -a -S "${XDG_RUNTIME_DIR}/.ydotool_socket" ]; then
        success "ydotoold socket detected"
    else
        warn "ydotoold installed but no socket detected yet. Start manually if needed: sudo ydotoold"
    fi
}

setup_linux_input_dependencies() {
    if [ "$(uname -s)" != "Linux" ]; then
        return 0
    fi

    if ! is_wayland_session; then
        info "Linux display server is not Wayland; skipping Wayland input dependency setup"
        return 0
    fi

    local desktop_family pm
    desktop_family=$(detect_linux_desktop_family)
    pm=$(detect_linux_package_manager)

    info "Wayland session detected (${desktop_family}); checking remote control dependencies..."

    local missing_components=()
    command -v gdbus &> /dev/null || missing_components+=("gdbus")
    command -v ydotool &> /dev/null || missing_components+=("ydotool")
    command -v ydotoold &> /dev/null || missing_components+=("ydotoold")
    command -v xdg-desktop-portal &> /dev/null || missing_components+=("xdg-desktop-portal")

    if [ ${#missing_components[@]} -eq 0 ]; then
        success "Wayland remote control helper binaries are already installed"
        return 0
    fi

    warn "Missing Wayland helper components: ${missing_components[*]}"

    if [ "$pm" = "unknown" ]; then
        warn "Could not detect a supported Linux package manager"
        warn "Install: ydotool, xdg-desktop-portal, a desktop portal backend (kde/gnome/wlr), and gdbus"
        return 0
    fi

    mapfile -t dep_packages < <(build_wayland_dep_packages "$pm" "$desktop_family")
    if [ ${#dep_packages[@]} -eq 0 ]; then
        warn "No package mapping found for package manager: $pm"
        return 0
    fi

    local install_cmd
    install_cmd=$(build_wayland_dep_install_command "$pm" "${dep_packages[@]}") || {
        warn "Could not build install command for package manager: $pm"
        return 0
    }

    info "Suggested package manager command:"
    echo "  $install_cmd"

    info "Installing Linux Wayland remote control dependencies via ${pm}..."
    if run_linux_dependency_install "$install_cmd"; then
        success "Linux Wayland dependency installation completed"
        start_ydotool_daemon_if_available
    else
        warn "Linux dependency install failed. You can run this manually:"
        echo "  $install_cmd"
    fi
}

# Download file (silent — for metadata fetches)
download() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$output"
    fi
}

# Download file with progress bar (for large binaries)
download_with_progress() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -fL --progress-bar "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget --progress=bar:force:noscroll "$url" -O "$output" 2>&1
    fi
}

# Get latest version from GitHub releases
get_latest_version() {
    local version
    version=$(download "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" - 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/^v//')

    if [ -z "$version" ]; then
        # Fallback to installer service
        version=$(download "${INSTALLER_URL}/api/version" - 2>/dev/null || echo "")
    fi

    if [ -z "$version" ]; then
        error "Failed to fetch latest version. Check your internet connection."
    fi

    echo "$version"
}

# Get download URL for platform
get_download_url() {
    local platform="$1"
    local version="$2"
    local os arch filename

    os=$(echo "$platform" | cut -d'-' -f1)
    arch=$(echo "$platform" | cut -d'-' -f2)

    case "$os" in
        darwin)
            # macOS uses zip files
            if [ "$arch" = "arm64" ]; then
                filename="PairUX-${version}-arm64-mac.zip"
            else
                filename="PairUX-${version}-mac.zip"
            fi
            ;;
        linux)
            # Linux uses AppImage
            if [ "$arch" = "arm64" ]; then
                filename="PairUX-${version}-arm64.AppImage"
            else
                filename="PairUX-${version}-x86_64.AppImage"
            fi
            ;;
        *)
            error "Unsupported platform: $platform"
            ;;
    esac

    echo "https://github.com/${GITHUB_REPO}/releases/download/v${version}/${filename}"
}

# Get ffmpeg download URL for platform (extracted from @ffmpeg-installer during CI)
get_ffmpeg_url() {
    local platform="$1"
    local version="$2"
    local os arch

    os=$(echo "$platform" | cut -d'-' -f1)
    arch=$(echo "$platform" | cut -d'-' -f2)

    # CI maps: darwin->mac, linux->linux, windows->win
    local ci_platform
    case "$os" in
        darwin) ci_platform="mac";;
        linux)  ci_platform="linux";;
        *)      return 1;;
    esac

    echo "https://github.com/${GITHUB_REPO}/releases/download/v${version}/ffmpeg-${ci_platform}-${arch}.gz"
}

# Install ffmpeg binary for RTMP streaming support
install_ffmpeg() {
    local platform="$1"
    local version="$2"

    local ffmpeg_url
    ffmpeg_url=$(get_ffmpeg_url "$platform" "$version") || {
        warn "ffmpeg not available for this platform (streaming will use system ffmpeg if available)"
        return 0
    }

    local ffmpeg_bin_dir="${INSTALL_DIR}/bin"
    local ffmpeg_path="${ffmpeg_bin_dir}/ffmpeg"

    info "Installing ffmpeg for streaming support..."
    mkdir -p "$ffmpeg_bin_dir"

    local temp_file
    temp_file=$(mktemp)

    if download_with_progress "$ffmpeg_url" "$temp_file"; then
        gunzip -c "$temp_file" > "$ffmpeg_path" 2>/dev/null
        chmod +x "$ffmpeg_path"
        rm -f "$temp_file"

        # Don't execute ffmpeg here: on macOS this can block during first-run
        # security checks and make the installer appear hung.
        if [ -s "$ffmpeg_path" ]; then
            success "ffmpeg installed"
        else
            warn "ffmpeg install verification failed — streaming will fall back to system ffmpeg"
            rm -f "$ffmpeg_path"
        fi
    else
        warn "Could not download ffmpeg — streaming will use system ffmpeg if available"
        rm -f "$temp_file"
    fi
}

# Install on macOS
install_macos() {
    local version="$1"
    local arch="$2"
    local temp_dir

    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    local download_url
    download_url=$(get_download_url "darwin-${arch}" "$version")

    info "Downloading PairUX ${version} for macOS ${arch}..."
    local archive_path="${temp_dir}/PairUX.zip"

    download_with_progress "$download_url" "$archive_path" || error "Failed to download PairUX"

    info "Extracting..."
    # Use ditto to preserve macOS file attributes, permissions, and code signing
    # (unzip strips executable bits from Electron helper apps, breaking the app)
    ditto -xk "$archive_path" "$temp_dir"

    # Move to Applications
    if [ -d "${APPLICATIONS_DIR}/PairUX.app" ]; then
        info "Removing existing installation..."
        rm -rf "${APPLICATIONS_DIR}/PairUX.app"
    fi

    mv "${temp_dir}/PairUX.app" "${APPLICATIONS_DIR}/"

    # Remove quarantine attribute so Gatekeeper doesn't block the app
    xattr -cr "${APPLICATIONS_DIR}/PairUX.app" 2>/dev/null || true

    # Create CLI wrapper script
    info "Creating launcher script..."
    mkdir -p "$BIN_DIR"
    warn_existing_launcher
    # Remove any existing symlink so we don't follow it into the app bundle
    # and overwrite the real Electron binary
    rm -f "$BIN_DIR/pairux"
    cat > "$BIN_DIR/pairux" << WRAPPER
#!/bin/bash
# PairUX launcher (macOS)

VERSION="$version"
INSTALLER_URL="$INSTALLER_URL"
APP_PATH="/Applications/PairUX.app"
APP_BIN="\$APP_PATH/Contents/MacOS/PairUX"
INSTALL_DIR="\$HOME/.pairux"
BIN_DIR="\$HOME/.local/bin"

case "\${1-}" in
    -h|--help)
        echo "Usage: pairux [options]"
        echo ""
        echo "PairUX - collaborative screen sharing desktop app"
        echo ""
        echo "Options:"
        echo "  -h, --help       Show this help message"
        echo "  -v, --version    Show version number"
        echo "  update|upgrade   Check for updates and install the latest version"
        echo "                   Use --force to reinstall when already up to date"
        echo "  uninstall|remove Remove PairUX completely"
        exit 0
        ;;
    -v|--version)
        echo "pairux \$VERSION"
        exit 0
        ;;
    update|upgrade)
        echo "Checking for updates..."
        FORCE_UPDATE=0
        for arg in "\${@:2}"; do
            if [ "\$arg" = "--force" ]; then
                FORCE_UPDATE=1
            fi
        done

        LATEST=\$(curl -fsSL "https://api.github.com/repos/profullstack/pairux.com/releases/latest" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/^v//')

        if [ -z "\$LATEST" ]; then
            LATEST=\$(curl -fsSL "https://installer.pairux.com/api/version" 2>/dev/null || echo "")
        fi

        if [ -z "\$LATEST" ]; then
            echo "Error: Failed to check for updates. Check your internet connection."
            exit 1
        fi

        echo "  Current version: \$VERSION"
        echo "  Latest version:  \$LATEST"

        echo ""
        if [ "\$VERSION" = "\$LATEST" ]; then
            echo "PairUX is already on the latest version."
            if [ "\$FORCE_UPDATE" -ne 1 ]; then
                echo "Skipping reinstall. Re-run with 'pairux update --force' to reinstall anyway."
                exit 0
            fi
            echo "Re-running installer to repair launcher/app integration (--force)..."
        else
            echo "Updating PairUX to v\$LATEST..."
        fi
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "\$INSTALLER_URL/install.sh" | bash
        elif command -v wget >/dev/null 2>&1; then
            wget -qO- "\$INSTALLER_URL/install.sh" | bash
        else
            echo "Error: curl or wget is required for updates."
            exit 1
        fi
        exit \$?
        ;;
    uninstall|remove)
        echo "Uninstalling PairUX..."
        echo ""

        # Kill running instances
        pkill -f "PairUX" 2>/dev/null && echo "  Stopped running instance"

        # Remove app bundle
        if [ -d "\$APP_PATH" ]; then
            if rm -rf "\$APP_PATH" 2>/dev/null; then
                echo "  Removed \$APP_PATH"
            elif command -v sudo >/dev/null 2>&1 && sudo rm -rf "\$APP_PATH"; then
                echo "  Removed \$APP_PATH (with sudo)"
            else
                echo "  Failed to remove \$APP_PATH (permission denied)"
            fi
        fi

        # Remove support directory used for bundled ffmpeg
        if [ -d "\$INSTALL_DIR" ]; then
            rm -rf "\$INSTALL_DIR"
            echo "  Removed \$INSTALL_DIR"
        fi

        # Remove app data/cache/logs for a full uninstall
        for path in \
            "\$HOME/Library/Application Support/pairux" \
            "\$HOME/Library/Caches/pairux" \
            "\$HOME/Library/Logs/pairux" \
            "\$HOME/Library/Saved Application State/com.profullstack.pairux.savedState"
        do
            if [ -e "\$path" ]; then
                rm -rf "\$path" 2>/dev/null || true
                echo "  Removed \$path"
            fi
        done

        # Remove this launcher script last
        echo "  Removed \$BIN_DIR/pairux"
        echo ""
        echo "PairUX has been uninstalled."
        rm -f "\$BIN_DIR/pairux"
        exit 0
        ;;
esac

if [ -x "\$APP_BIN" ]; then
    # Launch from a stable working directory. A deleted caller cwd can break
    # Electron startup with confusing "open dir" errors.
    cd "\$HOME" 2>/dev/null || cd / 2>/dev/null || true
    # Check for macOS quarantine attribute which causes the app to hang silently
    if xattr -p com.apple.quarantine "\$APP_PATH" &>/dev/null; then
        echo ""
        echo "PairUX is blocked by macOS Gatekeeper (quarantine)."
        echo ""
        echo "To fix this, run:"
        echo "  xattr -cr /Applications/PairUX.app"
        echo ""
        echo "Or go to System Settings > Privacy & Security and click 'Open Anyway'."
        echo ""
        echo "Attempting to remove quarantine automatically..."
        if xattr -cr "\$APP_PATH" 2>/dev/null; then
            echo "Done! Launching PairUX..."
            echo ""
        else
            echo "Could not remove automatically. Please run the command above manually."
            exit 1
        fi
    fi
    exec "\$APP_BIN" "\$@"
else
    echo "Error: PairUX app not found at \$APP_PATH"
    echo "Please reinstall: curl -fsSL https://installer.pairux.com/install.sh | bash"
    exit 1
fi
WRAPPER
    chmod +x "$BIN_DIR/pairux"

    success "PairUX ${version} installed to ${APPLICATIONS_DIR}/PairUX.app"
}

# Install on Linux
install_linux() {
    local version="$1"
    local arch="$2"
    local temp_dir

    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    setup_linux_input_dependencies

    local download_url
    download_url=$(get_download_url "linux-${arch}" "$version")

    info "Downloading PairUX ${version} for Linux..."
    local appimage_path="${INSTALL_DIR}/PairUX.AppImage"

    mkdir -p "$INSTALL_DIR"
    download_with_progress "$download_url" "$appimage_path" || error "Failed to download PairUX"

    chmod +x "$appimage_path"

    # Create wrapper script that handles sandbox issues
    info "Creating launcher script..."
    mkdir -p "$BIN_DIR"
    warn_existing_launcher
    # Remove any existing symlink so we don't follow it and overwrite the AppImage
    rm -f "$BIN_DIR/pairux"
    cat > "$BIN_DIR/pairux" << WRAPPER
#!/bin/bash
# PairUX launcher
# ELECTRON_DISABLE_SANDBOX is required for AppImages without SUID chrome-sandbox

VERSION="$version"
INSTALLER_URL="$INSTALLER_URL"
APPIMAGE="\$HOME/.pairux/PairUX.AppImage"
INSTALL_DIR="\$HOME/.pairux"
BIN_DIR="\$HOME/.local/bin"
DESKTOP_FILE="\$HOME/.local/share/applications/pairux.desktop"
ICON_FILE="\$HOME/.local/share/icons/hicolor/256x256/apps/pairux.png"

case "\${1-}" in
    -h|--help)
        echo "Usage: pairux [options]"
        echo ""
        echo "PairUX - collaborative screen sharing desktop app"
        echo ""
        echo "Options:"
        echo "  -h, --help       Show this help message"
        echo "  -v, --version    Show version number"
        echo "  update|upgrade   Check for updates and install the latest version"
        echo "                   Use --force to reinstall when already up to date"
        echo "  uninstall|remove Remove PairUX completely"
        exit 0
        ;;
    -v|--version)
        echo "pairux \$VERSION"
        exit 0
        ;;
    uninstall|remove)
        echo "Uninstalling PairUX..."
        echo ""

        # Kill running instances
        pkill -f "PairUX.AppImage" 2>/dev/null && echo "  Stopped running instance"

        # Remove AppImage and install directory
        if [ -d "\$INSTALL_DIR" ]; then
            rm -rf "\$INSTALL_DIR"
            echo "  Removed \$INSTALL_DIR"
        fi

        # Remove app data/cache/logs for a full uninstall
        for path in \
            "\$HOME/.config/pairux" \
            "\$HOME/.cache/pairux" \
            "\$HOME/.local/share/pairux" \
            "\$HOME/.local/state/pairux"
        do
            if [ -e "\$path" ]; then
                rm -rf "\$path" 2>/dev/null || true
                echo "  Removed \$path"
            fi
        done

        # Remove desktop entry
        if [ -f "\$DESKTOP_FILE" ]; then
            rm -f "\$DESKTOP_FILE"
            echo "  Removed desktop entry"
            update-desktop-database "\$HOME/.local/share/applications" 2>/dev/null || true
        fi

        # Remove icon
        if [ -f "\$ICON_FILE" ]; then
            rm -f "\$ICON_FILE"
            echo "  Removed icon"
        fi

        # Remove this launcher script last
        echo "  Removed \$BIN_DIR/pairux"
        echo ""
        echo "PairUX has been uninstalled."
        rm -f "\$BIN_DIR/pairux"
        exit 0
        ;;
    update|upgrade)
        echo "Checking for updates..."
        FORCE_UPDATE=0
        for arg in "\${@:2}"; do
            if [ "\$arg" = "--force" ]; then
                FORCE_UPDATE=1
            fi
        done

        LATEST=\$(curl -fsSL "https://api.github.com/repos/profullstack/pairux.com/releases/latest" 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/^v//')

        if [ -z "\$LATEST" ]; then
            LATEST=\$(curl -fsSL "https://installer.pairux.com/api/version" 2>/dev/null || echo "")
        fi

        if [ -z "\$LATEST" ]; then
            echo "Error: Failed to check for updates. Check your internet connection."
            exit 1
        fi

        echo "  Current version: \$VERSION"
        echo "  Latest version:  \$LATEST"

        echo ""
        if [ "\$VERSION" = "\$LATEST" ]; then
            echo "PairUX is already on the latest version."
            if [ "\$FORCE_UPDATE" -ne 1 ]; then
                echo "Skipping reinstall. Re-run with 'pairux update --force' to reinstall anyway."
                exit 0
            fi
            echo "Re-running installer to repair launcher/app integration (--force)..."
        else
            echo "Updating PairUX to v\$LATEST..."
        fi
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "\$INSTALLER_URL/install.sh" | bash
        elif command -v wget >/dev/null 2>&1; then
            wget -qO- "\$INSTALLER_URL/install.sh" | bash
        else
            echo "Error: curl or wget is required for updates."
            exit 1
        fi
        exit \$?
        ;;
esac

if [ -x "\$APPIMAGE" ]; then
    export ELECTRON_DISABLE_SANDBOX=1
    # Unset ELECTRON_RUN_AS_NODE — VSCode's integrated terminal sets this,
    # which prevents Electron from exposing its API (app, BrowserWindow, etc.)
    unset ELECTRON_RUN_AS_NODE
    # Launch from a stable working directory. If the caller's cwd was deleted
    # (common with terminals in temp/build dirs), Electron/AppImage startup can
    # emit "open dir error: No such file or directory" on Linux.
    cd "\$HOME" 2>/dev/null || cd / 2>/dev/null || true

    # AppImage can also fail with the same error when inherited runtime/temp
    # dirs point to deleted paths (common after terminal multiplexers/shells
    # survive logouts or tmp cleanup). Sanitize them before exec.
    if [ -n "\${XDG_RUNTIME_DIR-}" ] && [ ! -d "\$XDG_RUNTIME_DIR" ]; then
        unset XDG_RUNTIME_DIR
    fi
    PAIRUX_TMP_DIR="\$HOME/.pairux/tmp"
    mkdir -p "\$PAIRUX_TMP_DIR" 2>/dev/null || true
    if [ -d "\$PAIRUX_TMP_DIR" ] && [ -w "\$PAIRUX_TMP_DIR" ]; then
        export TMPDIR="\$PAIRUX_TMP_DIR"
    elif [ -z "\${TMPDIR-}" ] || [ ! -d "\$TMPDIR" ] || [ ! -w "\$TMPDIR" ]; then
        export TMPDIR="/tmp"
    fi

    # If FUSE is unavailable or inaccessible (common in restricted/containerized
    # environments), fall back to extract-and-run mode so the AppImage can still
    # launch. A simple -r/-w check is not enough because /dev/fuse may exist but
    # still reject open() with EPERM.
    if [ -r /dev/fuse ] && [ -w /dev/fuse ] && (: <> /dev/fuse) 2>/dev/null; then
        exec "\$APPIMAGE" "\$@"
    else
        export APPIMAGE_EXTRACT_AND_RUN=1
        exec "\$APPIMAGE" "\$@"
    fi
else
    echo "Error: PairUX AppImage not found at \$APPIMAGE"
    echo "Please reinstall: curl -fsSL https://installer.pairux.com/install.sh | bash"
    exit 1
fi
WRAPPER
    chmod +x "$BIN_DIR/pairux"

    # Create .desktop file for application menu integration
    info "Creating desktop entry..."
    local desktop_dir="$HOME/.local/share/applications"
    local icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"
    mkdir -p "$desktop_dir" "$icon_dir"

    # Extract icon from AppImage if possible
    if command -v "$appimage_path" &> /dev/null; then
        # Try to extract the icon
        cd "$temp_dir"
        "$appimage_path" --appimage-extract "*.png" 2>/dev/null || true
        if [ -f "squashfs-root/pairux.png" ]; then
            cp "squashfs-root/pairux.png" "$icon_dir/"
        elif [ -f "squashfs-root/usr/share/icons/hicolor/256x256/apps/pairux.png" ]; then
            cp "squashfs-root/usr/share/icons/hicolor/256x256/apps/pairux.png" "$icon_dir/"
        fi
        cd - > /dev/null
    fi

    # Create .desktop file
    cat > "$desktop_dir/pairux.desktop" << DESKTOP
[Desktop Entry]
Name=PairUX
Comment=Screen sharing with remote control
Exec=$BIN_DIR/pairux %U
Icon=pairux
Terminal=false
Type=Application
Categories=Network;RemoteAccess;
StartupWMClass=PairUX
Keywords=screen;share;remote;control;
DESKTOP

    # Update desktop database if available
    if command -v update-desktop-database &> /dev/null; then
        update-desktop-database "$desktop_dir" 2>/dev/null || true
    fi

    success "PairUX ${version} installed to ${INSTALL_DIR}"
    info "Desktop entry created - PairUX should appear in your applications menu"
    if is_wayland_session; then
        info "Wayland remote control notes:"
        echo "  - Preferred path: xdg-desktop-portal (KDE/GNOME)"
        echo "  - Fallback path: ydotool + ydotoold (requires /dev/uinput access)"
        echo "  - Check portal: systemctl --user status xdg-desktop-portal"
        echo "  - Check ydotoold socket: ls -l \$XDG_RUNTIME_DIR/.ydotool_socket /tmp/.ydotool_socket"
    fi
}

# Download and install
install_pairux() {
    local platform="$1"
    local version="$2"
    local os arch

    os=$(echo "$platform" | cut -d'-' -f1)
    arch=$(echo "$platform" | cut -d'-' -f2)

    case "$os" in
        darwin)
            install_macos "$version" "$arch"
            ;;
        linux)
            install_linux "$version" "$arch"
            ;;
        *)
            error "Unsupported operating system: $os"
            ;;
    esac

    install_ffmpeg "$platform" "$version"
}

# Add to PATH if needed
setup_path() {
    local shell_config=""
    local path_line="export PATH=\"\$PATH:$BIN_DIR\""

    # Detect shell config file
    if [ -n "$BASH_VERSION" ]; then
        if [ -f "$HOME/.bashrc" ]; then
            shell_config="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            shell_config="$HOME/.bash_profile"
        fi
    elif [ -n "$ZSH_VERSION" ]; then
        shell_config="$HOME/.zshrc"
    fi

    # Check if BIN_DIR is already in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        if [ -n "$shell_config" ]; then
            if ! grep -q "$BIN_DIR" "$shell_config" 2>/dev/null; then
                echo "" >> "$shell_config"
                echo "# PairUX" >> "$shell_config"
                echo "$path_line" >> "$shell_config"
                warn "Added $BIN_DIR to PATH in $shell_config"
                warn "Run 'source $shell_config' or restart your terminal"
            fi
        else
            warn "Add the following to your shell config:"
            echo "  $path_line"
        fi
    fi
}

# Main
main() {
    print_banner

    info "Detecting platform..."
    local platform
    platform=$(detect_platform)
    info "Platform: ${platform}"

    check_dependencies

    info "Fetching latest version..."
    local version
    version=$(get_latest_version)
    info "Latest version: ${version}"

    install_pairux "$platform" "$version"
    setup_path

    echo ""
    success "Installation complete!"
    echo ""
    echo "  Run 'pairux --help' to get started"
    echo "  Or visit https://pairux.com/docs for documentation"
    echo ""
}

main "$@"
