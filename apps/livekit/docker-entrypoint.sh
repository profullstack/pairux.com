#!/bin/sh
set -e

# ===========================================
# PairUX LiveKit Server Entrypoint
# ===========================================
# Substitutes environment variables into config
# ===========================================

CONFIG_FILE="/etc/livekit.yaml"

# Inject API keys from environment
if [ -n "$LIVEKIT_API_KEY" ] && [ -n "$LIVEKIT_API_SECRET" ]; then
  # Replace empty keys with actual key/secret pair
  sed -i "s/^keys: {}/keys:\n  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}/" "$CONFIG_FILE"
  echo "Configured API key: $LIVEKIT_API_KEY"
else
  echo "WARNING: LIVEKIT_API_KEY and LIVEKIT_API_SECRET not set, using default dev keys"
  sed -i "s/^keys: {}/keys:\n  devkey: secret/" "$CONFIG_FILE"
fi

# Auto-detect external IP for RTC
if [ -n "$EXTERNAL_IP" ]; then
  echo "Using configured external IP: $EXTERNAL_IP"
else
  EXTERNAL_IP=$(wget -q -O - ifconfig.me 2>/dev/null || wget -q -O - icanhazip.com 2>/dev/null || echo "")
  if [ -n "$EXTERNAL_IP" ]; then
    echo "Detected external IP: $EXTERNAL_IP"
  fi
fi

if [ -n "$EXTERNAL_IP" ]; then
  # Add node_ip to rtc section
  sed -i "/^rtc:/a\\  node_ip: ${EXTERNAL_IP}" "$CONFIG_FILE"
fi

echo "Starting LiveKit SFU server..."
exec livekit-server --config "$CONFIG_FILE" "$@"
