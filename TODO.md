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

- [x] **Remote Control (Viewer)**
  - [x] Request control button
  - [x] Control status indicator (view-only/granted)
  - [x] Mouse input capture & transmission
  - [x] Keyboard input capture & transmission
  - [x] Multi-cursor overlay (see other participants)

- [x] **PWA Features**
  - [x] Service worker for offline shell
  - [x] Web app manifest
  - [x] Install prompt
  - [ ] Push notification support (future)

---

## 💬 Text Chat System (SSE/POST)

### API Endpoints (Server-Side)

- [x] **POST /api/chat/send**
  - [x] Validate session membership
  - [x] Store message in Supabase
  - [x] Broadcast via Supabase Realtime
  - [x] Rate limiting (10 msg/min)

- [x] **GET /api/chat/stream (SSE)**
  - [x] Server-Sent Events connection
  - [x] Real-time message delivery
  - [x] Heartbeat/keepalive
  - [x] Reconnection handling

- [x] **GET /api/chat/history**
  - [x] Fetch last 100 messages
  - [x] Pagination support
  - [x] Session-scoped access

### Chat UI Components

- [x] **Chat Panel**
  - [x] Collapsible sidebar/drawer
  - [x] Message list with auto-scroll
  - [x] Participant avatars/colors
  - [x] Timestamp display
  - [x] Unread message indicator

- [x] **Message Input**
  - [x] Text input with send button
  - [x] Enter to send, Shift+Enter for newline
  - [x] Character limit (500)
  - [ ] Typing indicator (optional)

- [x] **Message Types**
  - [x] Text messages
  - [x] System messages (join/leave/control)
  - [x] Emoji support (native)

### Data Model

- [x] **chat_messages table**
  - [x] id (uuid)
  - [x] session_id (fk)
  - [x] user_id (fk, nullable for guests)
  - [x] display_name (string)
  - [x] content (text)
  - [x] message_type (text/system)
  - [x] created_at (timestamp)

---

## 🖥️ Desktop App (Electron)

### Core Functionality

- [x] **Screen Capture**
  - [x] Screen/window picker dialog
  - [x] Capture via Electron desktopCapturer
  - [x] Frame rate optimization (30fps target)
  - [x] Resolution scaling options

- [x] **Screen Recording (Local)**
  - [x] Start/stop recording controls
  - [x] Record to local file (WebM/MP4)
  - [x] Audio capture option (system audio + mic)
  - [x] Recording indicator overlay
  - [x] Auto-save on session end
  - [x] File location picker
  - [x] Recording quality presets (720p/1080p/4K)
  - [x] Pause/resume recording
  - [x] Recording duration display
  - [x] Storage space warning

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

- [x] **WebRTC Streaming**
  - [x] Peer connection management
  - [x] ICE candidate handling
  - [x] STUN/TURN configuration
  - [x] Adaptive bitrate encoding
  - [x] Connection quality monitoring

- [x] **Input Injection (nut.js)**
  - [x] Mouse movement injection
  - [x] Mouse click injection (left/right/middle)
  - [x] Mouse scroll injection
  - [x] Keyboard input injection
  - [x] Special key handling (modifiers, function keys)

### Session Management

- [x] **Host Controls**
  - [x] Start new session
  - [x] P2P vs SFU mode selection at session start
  - [x] Generate shareable link
  - [x] Copy link to clipboard
  - [x] View participant list
  - [x] End session

- [x] **Control State Machine**
  - [x] View-only (default)
  - [x] Control requested (pending)
  - [x] Control granted (active)
  - [x] Control revoked
  - [x] Emergency revoke hotkey (Ctrl+Shift+Escape)

- [x] **Participant Management**
  - [x] See who's connected
  - [x] Grant/revoke control per participant
  - [x] Kick participant
  - [x] Control request notifications

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

- [x] **macOS**
  - [x] Accessibility permission request
  - [x] Screen Recording permission request
  - [x] Input Monitoring permission request
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

- [x] **Persistent Room Model**
  - [x] Decouple room lifecycle from host connection
  - [x] Room survives host disconnects (status: `open | active | paused | closed`)
  - [x] Add `current_host_id` field (nullable) to sessions table
  - [x] Implement room TTL expiration (configurable, e.g., 24h inactive)
  - [x] Room only closes via explicit action or TTL expiration

- [x] **Media Sessions (Ephemeral)**
  - [x] Create `media_sessions` table (separate from rooms)
  - [x] Track media session properties: `id`, `room_id`, `mode`, `publisher_id`, `status`
  - [x] Media session states: `active | paused | ended`
  - [x] End/pause media session when host disconnects (room stays alive)
  - [x] Allow new media session to attach when host reconnects or transfers

### Host Disconnection Handling

- [x] **Immediate Behavior**
  - [x] Room remains open on host disconnect
  - [x] Viewers stay connected to UI, chat, presence, SFU (if applicable)
  - [x] Screen share pauses/freezes gracefully (last frame or placeholder)
  - [x] No automatic participant kick

- [x] **UX Messaging**
  - [x] "Host disconnected. Waiting for reconnection…" overlay
  - [x] Countdown timer or reconnection status indicator
  - [x] Clear visual state for "host offline"
  - [x] Only hard-kick when room is explicitly closed

### Reconnection Logic

- [x] **Grace Period**
  - [x] Implement host reconnection window (2-5 minutes configurable)
  - [x] Auto-reattach returning host (no participant disruption)
  - [x] Resume screen sharing on host reconnect
  - [x] ICE restart for P2P connections on reconnect

- [x] **Host Reassignment (if host doesn't return)**
  - [x] Option A: Admin/host can pre-designate backup host
  - [x] Option B: Auto-promote a controller to host role
  - [x] Option C: Viewer-only continuation (room stays alive, no screen share)
  - [x] New host can start fresh screen sharing session

### Presence & Heartbeats

- [x] **Client Heartbeats**
  - [x] Periodic heartbeat from all clients (every 30s)
  - [x] Soft-state presence (disconnection inferred, not immediate)
  - [x] Grace period before marking participant offline
  - [x] Avoid false "everyone dropped" on brief network blips

- [x] **Host Status Tracking**
  - [x] Track `host_last_seen_at` timestamp
  - [x] Distinguish between "host offline" vs "host left intentionally"
  - [x] Broadcast host status changes to all participants

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
  - [x] State management (usePresence, useInputInjection hooks)
  - [x] API route handlers

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
