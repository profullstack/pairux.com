#!/bin/bash
# ===========================================
# PairUX LiveKit SFU Server Setup Script
# ===========================================
# Run this on a fresh Ubuntu 24.04 droplet as root
# This script is fully idempotent - safe to run multiple times
# Usage: ./setup-livekit-server.sh <LIVEKIT_API_KEY> <LIVEKIT_API_SECRET>
# ===========================================

set -e

LIVEKIT_API_KEY="${1:-}"
LIVEKIT_API_SECRET="${2:-}"
EXTERNAL_IP="${3:-$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo '')}"
DOMAIN="${4:-sfu.pairux.com}"

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

# Check for required args
if [ -z "$LIVEKIT_API_KEY" ] || [ -z "$LIVEKIT_API_SECRET" ]; then
  echo "Usage: $0 <LIVEKIT_API_KEY> <LIVEKIT_API_SECRET> [EXTERNAL_IP] [DOMAIN]"
  echo ""
  echo "Example:"
  echo "  $0 APIpairux 'my-secure-secret'"
  echo "  $0 APIpairux 'my-secure-secret' 146.190.163.128 sfu.pairux.com"
  exit 1
fi

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  PairUX LiveKit SFU Server Setup${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
info "External IP: $EXTERNAL_IP"
info "Domain: $DOMAIN"
info "API Key: $LIVEKIT_API_KEY"
echo ""

# ===========================================
# System Setup
# ===========================================

info "Updating system packages..."
apt-get update -qq

UPGRADEABLE=$(apt list --upgradable 2>/dev/null | wc -l)
if [ "$UPGRADEABLE" -gt 1 ]; then
  info "Upgrading $((UPGRADEABLE - 1)) packages..."
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
else
  skip "System packages already up to date"
fi

info "Checking base packages..."
PACKAGES="curl wget git vim htop tmux zsh unzip jq fail2ban ufw"
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
# Docker Setup
# ===========================================

info "Checking Docker..."
if ! command -v docker &> /dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  success "Docker installed"
else
  skip "Docker already installed"
fi

# ===========================================
# User Setup
# ===========================================

USERNAME="ubuntu"
info "Setting up $USERNAME user..."

if ! id "$USERNAME" &>/dev/null; then
  useradd -m -s /bin/zsh "$USERNAME"
  info "Created user $USERNAME"
else
  skip "User $USERNAME already exists"
fi

CURRENT_SHELL=$(getent passwd "$USERNAME" | cut -d: -f7)
if [ "$CURRENT_SHELL" != "/bin/zsh" ]; then
  chsh -s /bin/zsh "$USERNAME"
  info "Set zsh as default shell"
else
  skip "Shell already set to zsh"
fi

USER_HOME="/home/$USERNAME"

if [ ! -d "$USER_HOME/.oh-my-zsh" ]; then
  info "Installing oh-my-zsh..."
  sudo -u "$USERNAME" sh -c 'RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"' || true
else
  skip "oh-my-zsh already installed"
fi

info "Updating .zshrc..."
cat > "$USER_HOME/.zshrc" << 'ZSHRC'
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git docker)
source $ZSH/oh-my-zsh.sh

# Aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias lklogs='sudo docker compose -f /opt/pairux-livekit/docker-compose.yml logs -f'
alias lkstatus='sudo docker compose -f /opt/pairux-livekit/docker-compose.yml ps'
alias lkrestart='sudo docker compose -f /opt/pairux-livekit/docker-compose.yml restart'

# Path
export PATH="$HOME/.local/bin:$PATH"
ZSHRC

chown "$USERNAME:$USERNAME" "$USER_HOME/.zshrc"

SUDOERS_FILE="/etc/sudoers.d/$USERNAME"
echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"

# Add user to docker group
if ! groups "$USERNAME" | grep -q docker; then
  usermod -aG docker "$USERNAME"
  info "Added $USERNAME to docker group"
else
  skip "$USERNAME already in docker group"
fi

# ===========================================
# SSH Setup
# ===========================================

info "Configuring SSH..."

if [ -f /root/.ssh/authorized_keys ]; then
  mkdir -p "$USER_HOME/.ssh"
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

ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1

add_ufw_rule() {
  local rule="$1"
  local comment="$2"
  if ! ufw status | grep -q "$rule"; then
    ufw allow $rule comment "$comment" >/dev/null 2>&1
    info "Added firewall rule: $rule ($comment)"
  fi
}

add_ufw_rule "22/tcp" "SSH"
add_ufw_rule "7880/tcp" "LiveKit WebSocket signaling"
add_ufw_rule "7881/tcp" "LiveKit RTC over TCP"
add_ufw_rule "7882/udp" "LiveKit RTC over UDP"
add_ufw_rule "443/tcp" "HTTPS (Caddy)"
add_ufw_rule "80/tcp" "HTTP (Caddy ACME)"
add_ufw_rule "3478/udp" "LiveKit TURN UDP"
add_ufw_rule "50000:50200/udp" "LiveKit WebRTC media"

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

if ! systemctl is-enabled fail2ban &>/dev/null; then
  systemctl enable fail2ban >/dev/null 2>&1
  info "Enabled fail2ban service"
fi

systemctl restart fail2ban

# ===========================================
# Caddy Reverse Proxy (TLS termination)
# ===========================================

info "Setting up Caddy for TLS..."

if ! command -v caddy &> /dev/null; then
  info "Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https -qq
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y caddy -qq
  success "Caddy installed"
else
  skip "Caddy already installed"
fi

info "Writing landing page..."
mkdir -p /var/www/pairux-sfu
cat > /var/www/pairux-sfu/index.html << 'INDEXEOF'
<!DOCTYPE html>
<html>
<head>
  <title>PairUX SFU Server</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4fc3f7; font-size: 2rem; margin-bottom: 0.5rem; }
    .status { color: #66bb6a; font-size: 1.2rem; }
    .info { color: #888; margin-top: 1.5rem; font-size: 0.9rem; }
    a { color: #4fc3f7; }
  </style>
</head>
<body>
  <div class="container">
    <h1>PairUX SFU Server</h1>
    <p class="status">LiveKit is running</p>
    <p class="info">Selective Forwarding Unit for <a href="https://pairux.com">pairux.com</a></p>
  </div>
</body>
</html>
INDEXEOF

info "Updating Caddyfile..."
cat > /etc/caddy/Caddyfile << EOF
${DOMAIN} {
  @landing {
    path /
    not header Connection *Upgrade*
  }
  handle @landing {
    root * /var/www/pairux-sfu
    file_server
  }
  handle {
    reverse_proxy localhost:7880
  }
}
EOF

systemctl enable caddy >/dev/null 2>&1
if systemctl restart caddy; then
  success "Caddy started (TLS will auto-provision for $DOMAIN)"
else
  warn "Caddy failed to start - ensure DNS for $DOMAIN points to this server, then run: systemctl restart caddy"
fi

# ===========================================
# LiveKit Server (Docker)
# ===========================================

info "Setting up LiveKit server..."

LIVEKIT_DIR="/opt/pairux-livekit"
mkdir -p "$LIVEKIT_DIR"

# LiveKit config
info "Writing LiveKit config..."
cat > "$LIVEKIT_DIR/livekit.yaml" << EOF
port: 7880

rtc:
  port_range_start: 50000
  port_range_end: 50200
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
  node_ip: ${EXTERNAL_IP}

keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}

room:
  empty_timeout: 300
  departure_timeout: 30
  max_participants: 20

logging:
  level: info

turn:
  enabled: true
  tls_port: 0
  udp_port: 3478
EOF

# Docker compose
info "Writing docker-compose.yml..."
cat > "$LIVEKIT_DIR/docker-compose.yml" << 'EOF'
services:
  livekit:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    command: --config /etc/livekit.yaml
EOF

# Start LiveKit
info "Starting LiveKit server..."
cd "$LIVEKIT_DIR"
docker compose pull
docker compose down 2>/dev/null || true
docker compose up -d

# Wait for service to start
sleep 5

# Check status
if docker compose ps | grep -q "running"; then
  success "LiveKit server is running!"
else
  warn "LiveKit may not be running. Check: docker compose -f $LIVEKIT_DIR/docker-compose.yml logs"
fi

# ===========================================
# Summary
# ===========================================

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  LiveKit SFU Server Setup Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Server Details:"
echo "  IP:      $EXTERNAL_IP"
echo "  Domain:  $DOMAIN"
echo "  WSS:     wss://$DOMAIN"
echo "  API Key: $LIVEKIT_API_KEY"
echo ""
echo "SSH Access:"
echo "  ssh $USERNAME@$EXTERNAL_IP"
echo ""
echo "Useful Commands (as $USERNAME):"
echo "  lkstatus   - Check LiveKit status"
echo "  lklogs     - View LiveKit logs"
echo "  lkrestart  - Restart LiveKit"
echo ""
echo "Web App Config (.env):"
echo "  LIVEKIT_API_KEY=$LIVEKIT_API_KEY"
echo "  LIVEKIT_API_SECRET=<configured>"
echo "  NEXT_PUBLIC_LIVEKIT_URL=wss://$DOMAIN"
echo ""
