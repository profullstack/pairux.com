# ===========================================
# PairUX TURN Server - coturn
# ===========================================
# STUN/TURN server for WebRTC NAT traversal
# Deploy on Fly.io or VPS (NOT Railway - no UDP support)
# ===========================================

FROM coturn/coturn:latest

# Install curl for IP detection
USER root
RUN apk add --no-cache curl

# Copy configuration template
COPY turnserver.conf /etc/turnserver.conf.template
COPY turnserver.conf /etc/turnserver.conf

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory for coturn
RUN mkdir -p /var/lib/coturn && chown nobody:nobody /var/lib/coturn

# Switch back to nobody user
USER nobody

# Expose ports
# 3478 - STUN/TURN (UDP and TCP)
# 5349 - TURN over TLS
# 49152-49252 - Relay ports
EXPOSE 3478/tcp
EXPOSE 3478/udp
EXPOSE 5349/tcp
EXPOSE 5349/udp
EXPOSE 49152-49252/udp

# Health check using STUN binding request
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD turnutils_uclient -T -n 1 127.0.0.1 2>/dev/null || exit 1

# Run via entrypoint
ENTRYPOINT ["/docker-entrypoint.sh"]
