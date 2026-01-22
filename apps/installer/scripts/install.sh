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
INSTALLER_URL="${PAIRUX_INSTALLER_URL:-https://installer.pairux.com}"
INSTALL_DIR="${PAIRUX_INSTALL_DIR:-$HOME/.pairux}"
BIN_DIR="${PAIRUX_BIN_DIR:-$HOME/.local/bin}"

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

# Get latest version
get_latest_version() {
    local version
    version=$(download "${INSTALLER_URL}/api/version" - 2>/dev/null || echo "")

    if [ -z "$version" ]; then
        error "Failed to fetch latest version. Check your internet connection."
    fi

    echo "$version"
}

# Download and install
install_pairux() {
    local platform="$1"
    local version="$2"
    local temp_dir

    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    info "Downloading PairUX ${version} for ${platform}..."

    local download_url="${INSTALLER_URL}/download/${version}/${platform}"
    local archive_path="${temp_dir}/pairux.tar.gz"

    download "$download_url" "$archive_path" || error "Failed to download PairUX"

    info "Extracting..."
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$archive_path" -C "$INSTALL_DIR"

    # Create symlink in bin directory
    mkdir -p "$BIN_DIR"
    ln -sf "$INSTALL_DIR/pairux" "$BIN_DIR/pairux"

    success "PairUX ${version} installed successfully!"
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
