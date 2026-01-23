# PairUX TURN Server

STUN/TURN server for WebRTC NAT traversal using [coturn](https://github.com/coturn/coturn).

**Hostname:** `turn.pairux.com`

## Why TURN?

WebRTC requires STUN/TURN servers when:

- Clients are behind symmetric NATs
- Firewalls block peer-to-peer connections
- Direct connections fail (~15-20% of cases)

## Quick Deploy to DigitalOcean Droplet

### 1. Create Droplet

```bash
# Via doctl CLI
doctl compute droplet create pairux-turn \
  --region nyc1 \
  --size s-1vcpu-1gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys YOUR_SSH_KEY_ID

# Or use the DigitalOcean console
# Choose: Ubuntu 24.04, $6/month droplet, add your SSH key
```

### 2. Deploy

```bash
cd apps/turn
./deploy-droplet.sh <DROPLET_IP> <TURN_PASSWORD>

# Example:
./deploy-droplet.sh 164.92.105.42 'super-secure-password-123'
```

### 3. Add DNS

Add an A record: `turn.pairux.com` → `<droplet-ip>`

### 4. Test

```bash
# From anywhere
turnutils_uclient -t -u pairux -w YOUR_PASSWORD turn.pairux.com
```

**Cost:** ~$6/month (1 vCPU, 1GB RAM)

---

## Configuration

### Ports Required

| Port        | Protocol | Purpose       |
| ----------- | -------- | ------------- |
| 3478        | UDP/TCP  | STUN/TURN     |
| 5349        | TCP      | TURN over TLS |
| 49152-49252 | UDP      | Media relay   |

### Environment Variables

| Variable        | Description   | Required          |
| --------------- | ------------- | ----------------- |
| `TURN_PASSWORD` | Auth password | Yes               |
| `EXTERNAL_IP`   | Public IP     | Auto-detected     |
| `REALM`         | Domain        | `turn.pairux.com` |

---

## WebRTC Integration

```javascript
const config = {
  iceServers: [
    // Free STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:turn.pairux.com:3478' },

    // TURN fallback (when direct connections fail)
    {
      urls: 'turn:turn.pairux.com:3478',
      username: 'pairux',
      credential: process.env.TURN_PASSWORD,
    },
    {
      urls: 'turns:turn.pairux.com:5349',
      username: 'pairux',
      credential: process.env.TURN_PASSWORD,
    },
  ],
};

const peerConnection = new RTCPeerConnection(config);
```

---

## Alternative: Managed TURN Services

If you prefer not to self-host:

| Service                                          | Free Tier | Notes              |
| ------------------------------------------------ | --------- | ------------------ |
| [Metered TURN](https://www.metered.ca/stun-turn) | 500 GB/mo | Recommended        |
| [Open Relay](https://www.openrelay.metered.ca/)  | Unlimited | Community/dev only |
| [Twilio](https://www.twilio.com/stun-turn)       | None      | Enterprise         |

---

## Testing

### Trickle ICE (Browser)

1. Go to https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Add server: `turn:turn.pairux.com:3478`
3. Enter username: `pairux`
4. Enter password: `<your-password>`
5. Click "Gather candidates"
6. Look for `relay` candidates

### CLI Test

```bash
# Install test utility
apt install coturn-utils

# Test STUN
turnutils_uclient -p 3478 turn.pairux.com

# Test TURN
turnutils_uclient -t -u pairux -w YOUR_PASSWORD turn.pairux.com
```

---

## Monitoring

```bash
# Check status
ssh root@<droplet-ip> "docker compose -f /opt/pairux-turn/docker-compose.yml ps"

# View logs
ssh root@<droplet-ip> "docker compose -f /opt/pairux-turn/docker-compose.yml logs -f"

# Restart
ssh root@<droplet-ip> "docker compose -f /opt/pairux-turn/docker-compose.yml restart"
```

---

## Notes

- **Railway:** Does NOT support UDP - use a droplet instead
- **Fly.io:** Alternative option (see fly.toml), supports UDP
- **Security:** Strong password required, private IPs blocked by default
