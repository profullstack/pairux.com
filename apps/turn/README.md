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
# SSH to droplet and run setup script
ssh root@<DROPLET_IP> "curl -fsSL https://raw.githubusercontent.com/profullstack/pairux.com/master/apps/turn/setup-turn-server.sh | bash -s -- 'YOUR_PASSWORD'"

# Or copy and run locally
scp apps/turn/setup-turn-server.sh root@<DROPLET_IP>:/root/
ssh root@<DROPLET_IP> "./setup-turn-server.sh 'YOUR_PASSWORD'"
```

### 3. Add DNS

Add an A record: `turn.pairux.com` → `<droplet-ip>`

### 4. Test

```bash
# From anywhere
turnutils_uclient -t -u ubuntu -w YOUR_PASSWORD turn.pairux.com
```

**Cost:** ~$6/month (1 vCPU, 1GB RAM)

---

## GitHub Actions Deployment

The TURN server can be automatically deployed via GitHub Actions when changes are pushed to `apps/turn/`.

### Required GitHub Secrets

| Secret                   | Description                                 |
| ------------------------ | ------------------------------------------- |
| `DROPLET_HOST`           | Droplet IP address (e.g., `143.198.96.161`) |
| `DROPLET_PORT`           | SSH port (default: `22`)                    |
| `DROPLET_USER`           | SSH user (e.g., `root` or `ubuntu`)         |
| `DROPLET_SSH_KEY`        | Private SSH key (base64 encoded)            |
| `TURN_SERVER_CREDENTIAL` | TURN password                               |

### Add Secrets

```bash
# Encode your SSH private key
cat ~/.ssh/id_rsa | base64 -w 0

# Add to GitHub:
# Settings → Secrets and variables → Actions → New repository secret
```

### Manual Trigger

You can also trigger deployment manually:

```bash
gh workflow run deploy-turn.yml
```

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
      username: 'ubuntu',
      credential: process.env.TURN_PASSWORD,
    },
    {
      urls: 'turns:turn.pairux.com:5349',
      username: 'ubuntu',
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
3. Enter username: `ubuntu`
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
turnutils_uclient -t -u ubuntu -w YOUR_PASSWORD turn.pairux.com
```

---

## Monitoring

```bash
# Check status
ssh root@<droplet-ip> "systemctl status coturn"

# View logs
ssh root@<droplet-ip> "tail -f /var/log/turnserver.log"
ssh root@<droplet-ip> "journalctl -u coturn -f"

# Restart
ssh root@<droplet-ip> "systemctl restart coturn"
```

---

## Notes

- **Railway:** Does NOT support UDP - use a droplet instead
- **Fly.io:** Alternative option (see fly.toml), supports UDP
- **Security:** Strong password required, private IPs blocked by default
