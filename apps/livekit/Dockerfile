# ===========================================
# PairUX LiveKit SFU Server
# ===========================================
# Selective Forwarding Unit for multi-viewer sessions
# Deploy on DigitalOcean droplet (sfu.pairux.com) or VPS
# ===========================================

FROM livekit/livekit-server:latest

# Copy configuration
COPY livekit.yaml /etc/livekit.yaml

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
USER root
RUN chmod +x /docker-entrypoint.sh
USER livekit

# WebSocket signaling (HTTP)
EXPOSE 7880/tcp
# RTC over TCP
EXPOSE 7881/tcp
# RTC over UDP
EXPOSE 7882/udp
# WebRTC media port range
EXPOSE 50000-50200/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:7880/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
