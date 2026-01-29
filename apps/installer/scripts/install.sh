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

# Download file
download() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$output"
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

    download "$download_url" "$archive_path" || error "Failed to download PairUX"

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

    # Create CLI symlink
    mkdir -p "$BIN_DIR"
    ln -sf "${APPLICATIONS_DIR}/PairUX.app/Contents/MacOS/PairUX" "$BIN_DIR/pairux"

    success "PairUX ${version} installed to ${APPLICATIONS_DIR}/PairUX.app"
}

# Install on Linux
install_linux() {
    local version="$1"
    local arch="$2"
    local temp_dir

    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    local download_url
    download_url=$(get_download_url "linux-${arch}" "$version")

    info "Downloading PairUX ${version} for Linux..."
    local appimage_path="${INSTALL_DIR}/PairUX.AppImage"

    mkdir -p "$INSTALL_DIR"
    download "$download_url" "$appimage_path" || error "Failed to download PairUX"

    chmod +x "$appimage_path"

    # Create wrapper script that handles sandbox issues
    info "Creating launcher script..."
    mkdir -p "$BIN_DIR"
    cat > "$BIN_DIR/pairux" << WRAPPER
#!/bin/bash
# PairUX launcher
# ELECTRON_DISABLE_SANDBOX is required for AppImages without SUID chrome-sandbox

VERSION="$version"
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
        echo "  uninstall        Remove PairUX completely"
        exit 0
        ;;
    -v|--version)
        echo "pairux \$VERSION"
        exit 0
        ;;
    uninstall)
        echo "Uninstalling PairUX..."
        echo ""

        # Kill running instances
        pkill -f "PairUX.AppImage" 2>/dev/null && echo "  Stopped running instance"

        # Remove AppImage and install directory
        if [ -d "\$INSTALL_DIR" ]; then
            rm -rf "\$INSTALL_DIR"
            echo "  Removed \$INSTALL_DIR"
        fi

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
esac

if [ -x "\$APPIMAGE" ]; then
    export ELECTRON_DISABLE_SANDBOX=1
    # Unset ELECTRON_RUN_AS_NODE — VSCode's integrated terminal sets this,
    # which prevents Electron from exposing its API (app, BrowserWindow, etc.)
    unset ELECTRON_RUN_AS_NODE
    exec "\$APPIMAGE" "\$@"
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
