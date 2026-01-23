#!/bin/bash
# ===========================================
# PairUX TURN Server - DigitalOcean Droplet Deployment
# ===========================================
# Usage: ./deploy-droplet.sh <droplet-ip> <turn-password>
# ===========================================

set -e

DROPLET_IP="${1:-}"
TURN_PASSWORD="${2:-}"
DOMAIN="${3:-turn.pairux.com}"

if [ -z "$DROPLET_IP" ] || [ -z "$TURN_PASSWORD" ]; then
  echo "Usage: ./deploy-droplet.sh <droplet-ip> <turn-password> [domain]"
  echo ""
  echo "Example:"
  echo "  ./deploy-droplet.sh 164.92.xxx.xxx 'my-secure-password'"
  echo "  ./deploy-droplet.sh 164.92.xxx.xxx 'my-secure-password' turn.example.com"
  exit 1
fi

echo "=== PairUX TURN Server Deployment ==="
echo "Droplet: $DROPLET_IP"
echo "Domain:  $DOMAIN"
echo ""

# Create deploy package
echo "Creating deployment package..."
DEPLOY_DIR=$(mktemp -d)
cp Dockerfile "$DEPLOY_DIR/"
cp docker-entrypoint.sh "$DEPLOY_DIR/"
cp turnserver.conf "$DEPLOY_DIR/"

# Create docker-compose.yml
cat > "$DEPLOY_DIR/docker-compose.yml" << EOF
version: '3.8'

services:
  coturn:
    build: .
    restart: unless-stopped
    network_mode: host
    environment:
      - TURN_PASSWORD=${TURN_PASSWORD}
      - EXTERNAL_IP=${DROPLET_IP}
      - REALM=${DOMAIN}
    volumes:
      - coturn-data:/var/lib/coturn

volumes:
  coturn-data:
EOF

# Create setup script to run on droplet
cat > "$DEPLOY_DIR/setup.sh" << 'SETUP_EOF'
#!/bin/bash
set -e

echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v docker-compose &> /dev/null; then
  apt-get update
  apt-get install -y docker-compose-plugin
fi

echo "Configuring firewall..."
ufw allow 22/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49152:49252/udp
ufw --force enable

echo "Building and starting TURN server..."
cd /opt/pairux-turn
docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo "Checking status..."
sleep 5
docker compose ps
docker compose logs --tail=20

echo ""
echo "=== TURN Server Deployed ==="
echo "Test with: turnutils_uclient -t -u pairux -w YOUR_PASSWORD $HOSTNAME"
SETUP_EOF

chmod +x "$DEPLOY_DIR/setup.sh"

echo "Uploading to droplet..."
ssh -o StrictHostKeyChecking=no "root@$DROPLET_IP" "mkdir -p /opt/pairux-turn"
scp -o StrictHostKeyChecking=no -r "$DEPLOY_DIR"/* "root@$DROPLET_IP:/opt/pairux-turn/"

echo "Running setup on droplet..."
ssh -o StrictHostKeyChecking=no "root@$DROPLET_IP" "cd /opt/pairux-turn && bash setup.sh"

# Cleanup
rm -rf "$DEPLOY_DIR"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "TURN Server: turn:$DROPLET_IP:3478"
echo "TURNS (TLS): turns:$DOMAIN:5349"
echo ""
echo "Add DNS record:"
echo "  $DOMAIN -> $DROPLET_IP"
echo ""
echo "WebRTC config:"
echo "  {"
echo "    urls: 'turn:$DOMAIN:3478',"
echo "    username: 'pairux',"
echo "    credential: '<your-password>'"
echo "  }"
