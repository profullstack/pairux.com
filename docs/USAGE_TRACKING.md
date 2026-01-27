# Usage Tracking & Billing

This document describes the usage tracking system for PairUX, designed to support usage-based billing for screen sharing sessions.

## Overview

PairUX tracks bandwidth usage for each screen sharing session. This data is used for:

1. **Usage-based billing** - Charge users based on data transferred
2. **Analytics** - Understand usage patterns and optimize performance
3. **Quality monitoring** - Track connection quality metrics

## Architecture

### Data Flow

```
┌─────────────┐     POST /api/.../stats      ┌─────────────┐
│   Desktop   │ ──────────────────────────▶  │   Web API   │
│    Host     │                              │             │
└─────────────┘                              └──────┬──────┘
       │                                            │
       │ WebRTC                                     │ INSERT
       │ P2P/TURN                                   ▼
       ▼                                     ┌─────────────┐
┌─────────────┐     POST /api/.../stats      │  Supabase   │
│  Web/Mobile │ ──────────────────────────▶  │  Database   │
│   Viewer    │                              │             │
└─────────────┘                              └─────────────┘
```

### Key Points

- **Video streams are peer-to-peer** - They don't flow through our servers
- **Clients report their own stats** - Using WebRTC's `getStats()` API
- **Stats are aggregated server-side** - For billing and analytics
- **Signaling goes through the API** - Enables central tracking and auth

## API Endpoints

### Signaling API

Used for WebRTC signaling (offer/answer/ICE candidates):

```typescript
// Send a signal (offer, answer, or ICE candidate)
POST /api/sessions/{sessionId}/signal
Content-Type: application/json

{
  "type": "offer" | "answer" | "ice-candidate",
  "sdp": "...",           // For offer/answer
  "candidate": {...},     // For ice-candidate
  "senderId": "uuid",
  "targetId": "uuid",     // Optional - target specific viewer
  "timestamp": 1234567890
}

// Receive signals via Server-Sent Events
GET /api/sessions/{sessionId}/signal/stream?participantId={id}

Events:
- connected    - SSE connection established
- subscribed   - Supabase channel subscribed
- signal       - WebRTC signaling message
- presence-join  - Viewer joined
- presence-leave - Viewer left
- heartbeat    - Keep-alive (every 30s)
```

### Stats Reporting API

Used for bandwidth and quality metrics:

```typescript
// Report usage statistics (called every 30 seconds)
POST /api/sessions/{sessionId}/stats
Content-Type: application/json

{
  "participantId": "uuid",
  "role": "host" | "viewer",
  "timestamp": 1234567890,
  "connectionState": "connected",

  // Bandwidth (bytes since last report)
  "bytesSent": 1234567,
  "bytesReceived": 123456,

  // Packets
  "packetsSent": 1000,
  "packetsReceived": 950,
  "packetsLost": 50,

  // Quality metrics (optional)
  "roundTripTime": 45.5,    // ms
  "jitter": 2.3,            // ms
  "frameRate": 30,
  "frameWidth": 1920,
  "frameHeight": 1080,

  "reportInterval": 30000   // ms
}

// Get session usage summary (host only)
GET /api/sessions/{sessionId}/stats

Response:
{
  "sessionId": "uuid",
  "totalBytesSent": 123456789,
  "totalBytesReceived": 12345678,
  "totalBytesTransferred": 135802467,
  "participants": [...],
  "reportCount": 42
}
```

## Database Schema

### session_usage Table

Stores individual usage reports:

```sql
CREATE TABLE session_usage (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id),
  participant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),

  role TEXT NOT NULL,  -- 'host' or 'viewer'

  -- Bandwidth (cumulative since last report)
  bytes_sent BIGINT NOT NULL DEFAULT 0,
  bytes_received BIGINT NOT NULL DEFAULT 0,

  -- Packets
  packets_sent BIGINT NOT NULL DEFAULT 0,
  packets_received BIGINT NOT NULL DEFAULT 0,
  packets_lost BIGINT NOT NULL DEFAULT 0,

  -- Quality metrics
  round_trip_time REAL,
  jitter REAL,
  frame_rate REAL,
  frame_width INTEGER,
  frame_height INTEGER,

  connection_state TEXT NOT NULL,
  report_interval_ms INTEGER NOT NULL,

  reported_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Views for Aggregation

```sql
-- Monthly usage per user (for billing)
CREATE VIEW user_usage_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', reported_at) AS month,
  COUNT(DISTINCT session_id) AS session_count,
  SUM(bytes_sent) AS total_bytes_sent,
  SUM(bytes_received) AS total_bytes_received,
  SUM(bytes_sent + bytes_received) AS total_bytes_transferred
FROM session_usage
WHERE user_id IS NOT NULL
GROUP BY user_id, DATE_TRUNC('month', reported_at);

-- Per-session summary
CREATE VIEW session_usage_summary AS
SELECT
  session_id,
  COUNT(DISTINCT participant_id) AS participant_count,
  SUM(bytes_sent + bytes_received) AS total_bytes_transferred,
  MIN(reported_at) AS first_report,
  MAX(reported_at) AS last_report
FROM session_usage
GROUP BY session_id;
```

### Billing Function

```sql
-- Get user's monthly usage for billing
SELECT * FROM get_user_monthly_usage(
  p_user_id := 'user-uuid',
  p_year := 2025,
  p_month := 1
);

-- Returns:
-- user_id | month_start | month_end | session_count | total_bytes_transferred | total_gb_transferred
```

## Client Implementation

### Desktop Host (useWebRTCHostAPI)

The desktop app uses `useWebRTCHostAPI` hook which:

1. Connects to signaling SSE stream
2. Creates peer connections for each viewer
3. Sends offers via HTTP POST
4. Receives answers/ICE candidates via SSE
5. Reports stats every 30 seconds

```typescript
// Usage in CapturePreview.tsx
const {
  isHosting,
  viewerCount,
  error: hostingError,
  startHosting,
  stopHosting,
} = useWebRTCHostAPI({
  sessionId: session.id,
  hostId: currentUserId,
  localStream: stream,
  allowControl: false,
  onViewerJoined: (viewerId) => console.log('Viewer joined:', viewerId),
  onViewerLeft: (viewerId) => console.log('Viewer left:', viewerId),
});

// Start hosting when session is created
useEffect(() => {
  if (session && stream && !isHosting) {
    startHosting();
  }
}, [session, stream, isHosting, startHosting]);
```

### Web Viewer (useWebRTC)

Web viewers use direct Supabase connection (existing implementation) but should also report stats:

```typescript
// Add to useWebRTC.ts
const reportStats = async () => {
  const stats = await peerConnection.getStats();
  // Parse stats and POST to /api/sessions/{sessionId}/stats
};

// Report every 30 seconds while connected
useEffect(() => {
  if (connectionState === 'connected') {
    const interval = setInterval(reportStats, 30000);
    return () => clearInterval(interval);
  }
}, [connectionState]);
```

## Billing Considerations

### What Gets Billed

1. **Host bandwidth** - Data sent from host to all viewers
2. **Viewer bandwidth** - Data received by each viewer (optional)

### Calculation

```
Monthly Usage (GB) = SUM(bytes_sent + bytes_received) / 1,073,741,824
```

### Rate Limiting

- Stats reports are rate-limited to 1 per 10 seconds per participant
- Signaling is rate-limited to 100 messages per minute

### Data Retention

Consider implementing:

- Aggregate old data (keep monthly summaries, delete raw reports)
- Retention policy (e.g., delete raw data after 90 days)

## Monitoring & Alerts

### Key Metrics to Track

1. **Usage spikes** - Unusual bandwidth consumption
2. **Report gaps** - Clients not reporting (possible evasion)
3. **Quality degradation** - High packet loss, RTT
4. **Connection failures** - Failed ICE negotiations

### Validation

Cross-validate host and viewer reports:

- Host reports bytes sent
- Viewers report bytes received
- Should roughly match (accounting for packet loss)

## Security Considerations

1. **Rate limiting** - Prevent report flooding
2. **Validation** - Ensure participant is in session
3. **Anomaly detection** - Flag suspicious patterns
4. **Audit trail** - Log all billing-relevant events

## Migration

Apply the database migration:

```bash
# Using Supabase CLI
supabase db push

# Or manually
psql $DATABASE_URL -f supabase/migrations/20250126000005_create_session_usage_table.sql
```

## Future Improvements

1. **TURN server integration** - Track relayed bandwidth
2. **Real-time billing dashboard** - Show current usage
3. **Usage alerts** - Notify users approaching limits
4. **Detailed analytics** - Quality reports, connection success rates
5. **SFU mode** - For large broadcasts, all traffic through server
