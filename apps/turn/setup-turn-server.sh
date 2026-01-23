#!/bin/bash
# ===========================================
# PairUX TURN Server Setup Script
# ===========================================
# Run this on a fresh Ubuntu 24.04 droplet as root
# This script is fully idempotent - safe to run multiple times
# Usage: curl -fsSL https://raw.githubusercontent.com/profullstack/pairux.com/master/apps/turn/setup-turn-server.sh | bash -s -- <TURN_PASSWORD>
# Or: ./setup-turn-server.sh <TURN_PASSWORD>
# ===========================================

set -e

TURN_PASSWORD="${1:-}"
EXTERNAL_IP="${2:-$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo '')}"
REALM="${3:-turn.pairux.com}"
USERNAME="ubuntu"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }

# Check for root
if [ "$EUID" -ne 0 ]; then
  error "Please run as root"
fi

# Check for password
if [ -z "$TURN_PASSWORD" ]; then
  echo "Usage: $0 <TURN_PASSWORD> [EXTERNAL_IP] [REALM]"
  echo ""
  echo "Example:"
  echo "  $0 'my-secure-password'"
  echo "  $0 'my-secure-password' 143.198.96.161 turn.pairux.com"
  exit 1
fi

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  PairUX TURN Server Setup (Idempotent)${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
info "External IP: $EXTERNAL_IP"
info "Realm: $REALM"
info "Username: $USERNAME"
echo ""

# ===========================================
# System Setup
# ===========================================

info "Updating system packages..."
apt-get update -qq

# Check if upgrade is needed (only upgrade if there are updates)
UPGRADEABLE=$(apt list --upgradable 2>/dev/null | wc -l)
if [ "$UPGRADEABLE" -gt 1 ]; then
  info "Upgrading $((UPGRADEABLE - 1)) packages..."
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
else
  skip "System packages already up to date"
fi

info "Checking base packages..."
PACKAGES="curl wget git vim htop tmux zsh unzip jq fail2ban ufw coturn"
MISSING_PACKAGES=""
for pkg in $PACKAGES; do
  if ! dpkg -s "$pkg" &>/dev/null; then
    MISSING_PACKAGES="$MISSING_PACKAGES $pkg"
  fi
done

if [ -n "$MISSING_PACKAGES" ]; then
  info "Installing missing packages:$MISSING_PACKAGES"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $MISSING_PACKAGES
else
  skip "All required packages already installed"
fi

# ===========================================
# User Setup
# ===========================================

info "Setting up $USERNAME user..."

# Create user if doesn't exist
if ! id "$USERNAME" &>/dev/null; then
  useradd -m -s /bin/zsh "$USERNAME"
  info "Created user $USERNAME"
else
  skip "User $USERNAME already exists"
fi

# Set zsh as default shell if not already
CURRENT_SHELL=$(getent passwd "$USERNAME" | cut -d: -f7)
if [ "$CURRENT_SHELL" != "/bin/zsh" ]; then
  chsh -s /bin/zsh "$USERNAME"
  info "Set zsh as default shell"
else
  skip "Shell already set to zsh"
fi

# Setup zsh for user
USER_HOME="/home/$USERNAME"

# Install oh-my-zsh for user if not installed
if [ ! -d "$USER_HOME/.oh-my-zsh" ]; then
  info "Installing oh-my-zsh..."
  sudo -u "$USERNAME" sh -c 'RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"' || true
else
  skip "oh-my-zsh already installed"
fi

# Create/update .zshrc (always update to ensure consistency)
info "Updating .zshrc..."
cat > "$USER_HOME/.zshrc" << 'ZSHRC'
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git)
source $ZSH/oh-my-zsh.sh

# Aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias turnlogs='sudo tail -f /var/log/turnserver.log'
alias turnstatus='sudo systemctl status coturn'
alias turnrestart='sudo systemctl restart coturn'

# Path
export PATH="$HOME/.local/bin:$PATH"
ZSHRC

chown "$USERNAME:$USERNAME" "$USER_HOME/.zshrc"

# Add user to sudoers with full passwordless sudo (idempotent - overwrites if exists)
SUDOERS_FILE="/etc/sudoers.d/$USERNAME"
echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"

# ===========================================
# SSH Setup
# ===========================================

info "Configuring SSH..."

# Copy root's authorized_keys to ubuntu user if exists and different
if [ -f /root/.ssh/authorized_keys ]; then
  mkdir -p "$USER_HOME/.ssh"

  # Only copy if different or doesn't exist
  if [ ! -f "$USER_HOME/.ssh/authorized_keys" ] || ! diff -q /root/.ssh/authorized_keys "$USER_HOME/.ssh/authorized_keys" &>/dev/null; then
    cp /root/.ssh/authorized_keys "$USER_HOME/.ssh/"
    info "Updated SSH keys for $USERNAME"
  else
    skip "SSH keys already in sync"
  fi

  chown -R "$USERNAME:$USERNAME" "$USER_HOME/.ssh"
  chmod 700 "$USER_HOME/.ssh"
  chmod 600 "$USER_HOME/.ssh/authorized_keys"
else
  skip "No root SSH keys to copy"
fi

# ===========================================
# Firewall Setup
# ===========================================

info "Configuring firewall..."

# Set defaults (idempotent)
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1

# Add rules idempotently
add_ufw_rule() {
  local rule="$1"
  local comment="$2"
  if ! ufw status | grep -q "$rule"; then
    ufw allow $rule comment "$comment" >/dev/null 2>&1
    info "Added firewall rule: $rule ($comment)"
  fi
}

add_ufw_rule "22/tcp" "SSH"
add_ufw_rule "3478/tcp" "TURN TCP"
add_ufw_rule "3478/udp" "TURN UDP"
add_ufw_rule "5349/tcp" "TURN TLS"
add_ufw_rule "49152:49252/udp" "TURN Relay"

# Enable UFW if not enabled
if ! ufw status | grep -q "Status: active"; then
  ufw --force enable >/dev/null 2>&1
  info "Enabled UFW firewall"
else
  skip "UFW already enabled"
fi

# ===========================================
# Fail2ban Setup
# ===========================================

info "Configuring fail2ban..."

# Create/update fail2ban config (always update for consistency)
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
F2B

# Enable fail2ban if not enabled
if ! systemctl is-enabled fail2ban &>/dev/null; then
  systemctl enable fail2ban >/dev/null 2>&1
  info "Enabled fail2ban service"
fi

systemctl restart fail2ban

# ===========================================
# Coturn Setup
# ===========================================

info "Configuring coturn..."

# Enable coturn service
if ! grep -q "TURNSERVER_ENABLED=1" /etc/default/coturn 2>/dev/null; then
  echo "TURNSERVER_ENABLED=1" > /etc/default/coturn
  info "Enabled coturn in /etc/default/coturn"
else
  skip "Coturn already enabled in /etc/default/coturn"
fi

# Create coturn configuration (always update to ensure correct password/settings)
info "Updating coturn configuration..."
cat > /etc/turnserver.conf << EOF
# ===========================================
# PairUX TURN Server Configuration
# ===========================================

# Listener ports
listening-port=3478
tls-listening-port=5349

# Relay ports
min-port=49152
max-port=49252

# External IP
external-ip=$EXTERNAL_IP

# Realm
realm=$REALM
server-name=$REALM

# Authentication
lt-cred-mech
user=$USERNAME:$TURN_PASSWORD

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
fingerprint
no-multicast-peers
no-loopback-peers
sha256
mobility
stale-nonce=600

# Rate limiting
max-allocations-per-user=10
total-quota=100
user-quota=10

# Denied peer IPs (block private networks)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255
EOF

# Create log file with proper permissions
if [ ! -f /var/log/turnserver.log ]; then
  touch /var/log/turnserver.log
  info "Created turnserver log file"
fi
chown turnserver:turnserver /var/log/turnserver.log

# ===========================================
# Start Services
# ===========================================

info "Starting coturn service..."

# Enable coturn if not enabled
if ! systemctl is-enabled coturn &>/dev/null; then
  systemctl enable coturn >/dev/null 2>&1
  info "Enabled coturn service"
fi

# Restart coturn to apply new config
systemctl restart coturn

# Wait for service to start
sleep 3

# Check status
if systemctl is-active --quiet coturn; then
  success "coturn is running!"
else
  error "coturn failed to start. Check: journalctl -u coturn"
fi

# Test STUN
info "Testing STUN..."
if command -v turnutils_uclient &> /dev/null; then
  if turnutils_uclient -p 3478 127.0.0.1 2>/dev/null; then
    success "STUN is working!"
  else
    warn "STUN test failed (may still work externally)"
  fi
fi

# ===========================================
# Summary
# ===========================================

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  TURN Server Setup Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Server Details:"
echo "  IP:    $EXTERNAL_IP"
echo "  STUN:  stun:$REALM:3478"
echo "  TURN:  turn:$REALM:3478"
echo "  TURNS: turns:$REALM:5349"
echo "  User:  $USERNAME"
echo "  Pass:  <configured>"
echo ""
echo "SSH Access:"
echo "  ssh $USERNAME@$EXTERNAL_IP"
echo ""
echo "Test TURN:"
echo "  turnutils_uclient -t -u $USERNAME -w 'YOUR_PASSWORD' $REALM"
echo ""
echo "Useful Commands (as $USERNAME):"
echo "  turnstatus   - Check coturn status"
echo "  turnlogs     - View coturn logs"
echo "  turnrestart  - Restart coturn"
echo ""
echo "Or use Trickle ICE:"
echo "  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
echo ""
