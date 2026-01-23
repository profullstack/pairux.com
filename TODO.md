# PairUX MVP - Go-to-Market Feature Checklist

> **Target:** Production-ready MVP for initial launch
> **Stack:** Node.js 24+, TypeScript, Next.js 16.2, Electron, Supabase, WebRTC

---

## 🏗️ Infrastructure & Setup

- [x] **Monorepo Foundation**
  - [x] pnpm workspace configuration
  - [x] Turborepo build pipeline
  - [x] Shared TypeScript config
  - [x] ESLint + Prettier setup
  - [x] Vitest test framework

- [x] **Environment & Deployment**
  - [x] Environment variable management (.env symlinks)
  - [x] Railway Docker deployment (web)
  - [x] GitHub Actions CI/CD
  - [x] Pre-commit hooks (lint, test, build)

---

## 🌐 Web App (Next.js PWA)

### Marketing Site

- [x] **Landing Page**
  - [x] Hero section with value proposition
  - [x] Feature highlights
  - [x] How it works (3-step flow)
  - [x] Social proof / testimonials placeholder
  - [x] CTA buttons (Download, Try Now)

- [x] **Features Page**
  - [x] Screen sharing capabilities
  - [x] Remote control features
  - [x] Screen recording (local)
  - [x] Text chat integration
  - [x] Security highlights

- [x] **Download Page**
  - [x] OS detection (auto-recommend)
  - [x] macOS: Homebrew cask command
  - [x] Windows: WinGet command
  - [x] Linux: apt/dnf/AUR commands
  - [x] Direct download links (GitHub Releases)
  - [x] SHA256 checksums display

- [x] **Pricing Page** (placeholder)
  - [x] Free tier details
  - [x] Future paid plans placeholder

- [x] **Docs/FAQ Page**
  - [x] Getting started guide
  - [x] System requirements
  - [x] Troubleshooting common issues
  - [x] Privacy & security FAQ

### PWA Viewer (Join Session)

- [x] **Session Join Flow**
  - [x] Join via link (no account required)
  - [x] Optional: Sign in for persistent identity
  - [x] Session code entry fallback

- [x] **Video Viewer**
  - [x] WebRTC video stream display
  - [x] Adaptive quality indicator
  - [x] Fullscreen toggle
  - [x] Connection status indicator

- [ ] **Remote Control (Viewer)**
  - [ ] Request control button
  - [ ] Control status indicator (view-only/granted)
  - [ ] Mouse input capture & transmission
  - [ ] Keyboard input capture & transmission
  - [ ] Multi-cursor overlay (see other participants)

- [ ] **PWA Features**
  - [ ] Service worker for offline shell
  - [ ] Web app manifest
  - [ ] Install prompt
  - [ ] Push notification support (future)

---

## 💬 Text Chat System (SSE/POST)

### API Endpoints (Server-Side)

- [ ] **POST /api/chat/send**
  - [ ] Validate session membership
  - [ ] Store message in Supabase
  - [ ] Broadcast via Supabase Realtime
  - [ ] Rate limiting (10 msg/min)

- [ ] **GET /api/chat/stream (SSE)**
  - [ ] Server-Sent Events connection
  - [ ] Real-time message delivery
  - [ ] Heartbeat/keepalive
  - [ ] Reconnection handling

- [ ] **GET /api/chat/history**
  - [ ] Fetch last 100 messages
  - [ ] Pagination support
  - [ ] Session-scoped access

### Chat UI Components

- [ ] **Chat Panel**
  - [ ] Collapsible sidebar/drawer
  - [ ] Message list with auto-scroll
  - [ ] Participant avatars/colors
  - [ ] Timestamp display
  - [ ] Unread message indicator

- [ ] **Message Input**
  - [ ] Text input with send button
  - [ ] Enter to send, Shift+Enter for newline
  - [ ] Character limit (500)
  - [ ] Typing indicator (optional)

- [ ] **Message Types**
  - [ ] Text messages
  - [ ] System messages (join/leave/control)
  - [ ] Emoji support (native)

### Data Model

- [ ] **chat_messages table**
  - [ ] id (uuid)
  - [ ] session_id (fk)
  - [ ] user_id (fk, nullable for guests)
  - [ ] display_name (string)
  - [ ] content (text)
  - [ ] message_type (text/system)
  - [ ] created_at (timestamp)

---

## 🖥️ Desktop App (Electron)

### Core Functionality

- [ ] **Screen Capture**
  - [ ] Screen/window picker dialog
  - [ ] Capture via Electron desktopCapturer
  - [ ] Frame rate optimization (30fps target)
  - [ ] Resolution scaling options

- [ ] **Screen Recording (Local)**
  - [ ] Start/stop recording controls
  - [ ] Record to local file (WebM/MP4)
  - [ ] Audio capture option (system audio + mic)
  - [ ] Recording indicator overlay
  - [ ] Auto-save on session end
  - [ ] File location picker
  - [ ] Recording quality presets (720p/1080p/4K)
  - [ ] Pause/resume recording
  - [ ] Recording duration display
  - [ ] Storage space warning

- [ ] **RTMP Live Streaming**
  - [ ] Add/edit/remove RTMP destinations
  - [ ] Multiple simultaneous streams (YouTube, Twitch, Facebook, custom)
  - [ ] Stream key secure storage (Electron safeStorage)
  - [ ] Platform presets (YouTube, Twitch, Facebook)
  - [ ] Encoder settings (H.264/AAC)
    - [ ] Video bitrate (2500-6000 kbps)
    - [ ] Resolution (720p/1080p)
    - [ ] Framerate (30/60 fps)
    - [ ] Keyframe interval (2 sec default)
    - [ ] Audio bitrate (128-320 kbps)
  - [ ] Start/stop individual streams
  - [ ] Start/stop all streams
  - [ ] Stream status indicators (connecting/live/error)
  - [ ] Stream duration display
  - [ ] Bitrate monitoring
  - [ ] Auto-reconnect on disconnect (3 attempts)
  - [ ] Error handling (auth failed, bandwidth, disconnected)

- [ ] **WebRTC Streaming**
  - [ ] Peer connection management
  - [ ] ICE candidate handling
  - [ ] STUN/TURN configuration
  - [ ] Adaptive bitrate encoding
  - [ ] Connection quality monitoring

- [ ] **Input Injection (nut.js)**
  - [ ] Mouse movement injection
  - [ ] Mouse click injection (left/right/middle)
  - [ ] Mouse scroll injection
  - [ ] Keyboard input injection
  - [ ] Special key handling (modifiers, function keys)

### Session Management

- [ ] **Host Controls**
  - [ ] Start new session
  - [ ] P2P vs SFU mode selection at session start
  - [ ] Generate shareable link
  - [ ] Copy link to clipboard
  - [ ] View participant list
  - [ ] End session

- [ ] **Control State Machine**
  - [ ] View-only (default)
  - [ ] Control requested (pending)
  - [ ] Control granted (active)
  - [ ] Control revoked
  - [ ] Emergency revoke hotkey (Ctrl+Shift+Escape)

- [ ] **Participant Management**
  - [ ] See who's connected
  - [ ] Grant/revoke control per participant
  - [ ] Kick participant
  - [ ] Control request notifications

### UI/UX

- [ ] **System Tray**
  - [ ] Tray icon with status
  - [ ] Quick actions menu
  - [ ] Session status indicator

- [ ] **Main Window**
  - [ ] Session dashboard
  - [ ] Screen preview
  - [ ] Participant list
  - [ ] Chat panel integration
  - [ ] Settings access

- [ ] **Overlay Indicators**
  - [ ] "Control Active" visual indicator
  - [ ] Remote cursor visualization
  - [ ] Recording/sharing indicator

### Platform-Specific

- [ ] **macOS**
  - [ ] Accessibility permission request
  - [ ] Screen Recording permission request
  - [ ] Input Monitoring permission request
  - [ ] Menu bar integration

- [ ] **Windows**
  - [ ] UAC handling
  - [ ] Windows Defender allowlisting docs

- [ ] **Linux**
  - [ ] X11 support
  - [ ] Wayland support (limited)
  - [ ] Permission documentation

---

## 🔐 Authentication & Authorization

- [ ] **Supabase Auth Integration**
  - [ ] Email/password signup
  - [ ] Email verification
  - [ ] Password reset flow
  - [ ] Session persistence

- [ ] **Guest Access**
  - [ ] Join without account
  - [ ] Temporary display name
  - [ ] Limited to viewer role

- [ ] **Session Authorization**
  - [ ] Host owns session
  - [ ] Participants join via link
  - [ ] RLS policies for data access

---

## 📡 Signaling & Real-time

- [ ] **Supabase Realtime Channels**
  - [ ] Session presence channel
  - [ ] Signaling channel (SDP/ICE)
  - [ ] Control state channel
  - [ ] Chat channel

- [ ] **WebRTC Signaling**
  - [ ] Offer/answer exchange
  - [ ] ICE candidate exchange
  - [ ] Renegotiation handling

- [ ] **TURN Server**
  - [ ] Self-hosted coturn setup
  - [ ] Credential generation
  - [ ] Fallback handling

---

## 🔄 Session Resilience & Host Disconnection

> **Principle:** A room is a durable object. A host is just a role.

### Room-Centric Architecture

- [ ] **Persistent Room Model**
  - [ ] Decouple room lifecycle from host connection
  - [ ] Room survives host disconnects (status: `open | active | paused | closed`)
  - [ ] Add `current_host_id` field (nullable) to sessions table
  - [ ] Implement room TTL expiration (configurable, e.g., 24h inactive)
  - [ ] Room only closes via explicit action or TTL expiration

- [ ] **Media Sessions (Ephemeral)**
  - [ ] Create `media_sessions` table (separate from rooms)
  - [ ] Track media session properties: `id`, `room_id`, `mode`, `publisher_id`, `status`
  - [ ] Media session states: `active | paused | ended`
  - [ ] End/pause media session when host disconnects (room stays alive)
  - [ ] Allow new media session to attach when host reconnects or transfers

### Host Disconnection Handling

- [ ] **Immediate Behavior**
  - [ ] Room remains open on host disconnect
  - [ ] Viewers stay connected to UI, chat, presence, SFU (if applicable)
  - [ ] Screen share pauses/freezes gracefully (last frame or placeholder)
  - [ ] No automatic participant kick

- [ ] **UX Messaging**
  - [ ] "Host disconnected. Waiting for reconnection…" overlay
  - [ ] Countdown timer or reconnection status indicator
  - [ ] Clear visual state for "host offline"
  - [ ] Only hard-kick when room is explicitly closed

### Reconnection Logic

- [ ] **Grace Period**
  - [ ] Implement host reconnection window (2-5 minutes configurable)
  - [ ] Auto-reattach returning host (no participant disruption)
  - [ ] Resume screen sharing on host reconnect
  - [ ] ICE restart for P2P connections on reconnect

- [ ] **Host Reassignment (if host doesn't return)**
  - [ ] Option A: Admin/host can pre-designate backup host
  - [ ] Option B: Auto-promote a controller to host role
  - [ ] Option C: Viewer-only continuation (room stays alive, no screen share)
  - [ ] New host can start fresh screen sharing session

### Presence & Heartbeats

- [ ] **Client Heartbeats**
  - [ ] Periodic heartbeat from all clients (every 30s)
  - [ ] Soft-state presence (disconnection inferred, not immediate)
  - [ ] Grace period before marking participant offline
  - [ ] Avoid false "everyone dropped" on brief network blips

- [ ] **Host Status Tracking**
  - [ ] Track `host_last_seen_at` timestamp
  - [ ] Distinguish between "host offline" vs "host left intentionally"
  - [ ] Broadcast host status changes to all participants

### SFU vs P2P Behavior

- [ ] **P2P Mode**
  - [ ] Media streams drop on host disconnect
  - [ ] Room stays alive for chat/presence
  - [ ] Reconnect requires SDP renegotiation
  - [ ] Participants not kicked

- [ ] **SFU Mode (Better UX)**
  - [ ] SFU keeps viewer connections alive
  - [ ] Viewers see last frame or placeholder
  - [ ] New publisher can attach seamlessly
  - [ ] No participant connection disruption

---

## 📦 Distribution

- [ ] **Build Pipeline**
  - [ ] electron-builder configuration
  - [ ] Multi-platform builds (mac/win/linux)
  - [ ] Code signing setup

- [ ] **Package Managers**
  - [ ] Homebrew cask formula
  - [ ] WinGet manifest
  - [ ] APT repository
  - [ ] AUR PKGBUILD

- [ ] **Shell Installers**
  - [ ] Unix installer script (install.sh)
  - [ ] Windows installer script (install.ps1)
  - [ ] Host at install.pairux.sh
  - [ ] Cloudflare Workers routing

- [ ] **Release Automation**
  - [ ] GitHub Releases
  - [ ] Changelog generation
  - [ ] SHA256 checksums
  - [ ] Auto-update mechanism

---

## 🧪 Testing

- [x] **Unit Tests**
  - [x] Utility functions
  - [ ] State management
  - [ ] API route handlers

- [ ] **Integration Tests**
  - [ ] Auth flows
  - [ ] Session lifecycle
  - [ ] Chat functionality

- [ ] **E2E Tests** (future)
  - [ ] Full session flow
  - [ ] Cross-browser testing

---

## 📊 Analytics & Monitoring (Post-MVP)

- [ ] Session metrics
- [ ] Error tracking
- [ ] Performance monitoring
- [ ] User feedback collection

---

## 🚀 Launch Checklist

- [ ] All MVP features complete
- [ ] Security audit passed
- [ ] Performance benchmarks met (<150ms latency)
- [ ] Documentation complete
- [ ] Package manager submissions
- [ ] Marketing site live
- [ ] Support channels ready

---

## Priority Order for Implementation

1. **Phase 1:** Monorepo + Web marketing site
2. **Phase 2:** Supabase auth + session management
3. **Phase 3:** Desktop app shell + screen capture
4. **Phase 4:** WebRTC streaming (host → viewer)
5. **Phase 5:** Text chat (SSE/POST)
6. **Phase 6:** Remote control (input injection)
7. **Phase 7:** RTMP live streaming (optional output)
8. **Phase 8:** Distribution + packaging
9. **Phase 9:** Polish + launch prep
