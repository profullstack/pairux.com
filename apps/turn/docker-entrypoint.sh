#!/bin/sh
set -e

# ===========================================
# PairUX TURN Server Entrypoint
# ===========================================
# Substitutes environment variables into config
# ===========================================

CONFIG_FILE="/etc/turnserver.conf"
TEMPLATE_FILE="/etc/turnserver.conf.template"

# Copy template if it exists
if [ -f "$TEMPLATE_FILE" ]; then
  cp "$TEMPLATE_FILE" "$CONFIG_FILE"
fi

# Substitute environment variables
if [ -n "$TURN_PASSWORD" ]; then
  sed -i "s/\${TURN_PASSWORD:-changeme}/$TURN_PASSWORD/g" "$CONFIG_FILE"
  echo "user=pairux:$TURN_PASSWORD" >> "$CONFIG_FILE"
fi

if [ -n "$EXTERNAL_IP" ]; then
  echo "external-ip=$EXTERNAL_IP" >> "$CONFIG_FILE"
fi

if [ -n "$REALM" ]; then
  sed -i "s/realm=turn.pairux.com/realm=$REALM/g" "$CONFIG_FILE"
  sed -i "s/server-name=turn.pairux.com/server-name=$REALM/g" "$CONFIG_FILE"
fi

# Auto-detect external IP if not set (for cloud deployments)
if [ -z "$EXTERNAL_IP" ]; then
  DETECTED_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "")
  if [ -n "$DETECTED_IP" ]; then
    echo "external-ip=$DETECTED_IP" >> "$CONFIG_FILE"
    echo "Detected external IP: $DETECTED_IP"
  fi
fi

echo "Starting coturn TURN server..."
exec turnserver -c "$CONFIG_FILE" "$@"
