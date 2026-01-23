# PairUX Architecture

## Overview

PairUX is a cross-platform collaborative screen sharing application with simultaneous local and remote mouse/keyboard control. This document describes the high-level system architecture.

## System Components

```mermaid
graph TB
    subgraph Web [Web - apps/web]
        Marketing[Marketing Site]
        JoinUI[Join/Viewer UI]
        WebRTCViewer[WebRTC Viewer]
    end

    subgraph Desktop [Desktop - apps/desktop]
        ElectronMain[Electron Main Process]
        ElectronRenderer[Electron Renderer]
        ScreenCapture[Screen Capture Module]
        InputInjector[Input Injector - nut.js]
        WebRTCHost[WebRTC Host Module]
    end

    subgraph Backend [Backend Services]
        Supabase[Supabase Cloud]
        Auth[Auth Service]
        Realtime[Realtime/Signaling]
        DB[(PostgreSQL)]
        TURN[Self-hosted TURN Server]
        STUN[STUN Server]
    end

    Marketing --> JoinUI
    JoinUI --> WebRTCViewer
    WebRTCViewer <--> |WebRTC| WebRTCHost
    WebRTCViewer <--> TURN
    WebRTCViewer <--> STUN

    ElectronRenderer --> ElectronMain
    ElectronMain --> ScreenCapture
    ElectronMain --> InputInjector
    ElectronMain --> WebRTCHost
    WebRTCHost <--> TURN
    WebRTCHost <--> STUN

    JoinUI --> Auth
    ElectronRenderer --> Auth
    Auth --> Supabase
    Realtime --> Supabase
    DB --> Supabase

    WebRTCViewer <--> |Signaling| Realtime
    WebRTCHost <--> |Signaling| Realtime
```

## Monorepo Structure

```
pairux/
├── apps/
│   ├── web/                    # Next.js marketing + join UI
│   │   ├── src/
│   │   │   ├── app/            # Next.js App Router
│   │   │   ├── components/     # React components
│   │   │   └── lib/            # Utilities
│   │   ├── public/
│   │   └── package.json
│   │
│   └── desktop/                # Electron desktop app
│       ├── src/
│       │   ├── main/           # Electron main process
│       │   ├── renderer/       # Electron renderer
│       │   └── preload/        # Preload scripts
│       ├── resources/          # App icons, assets
│       └── package.json
│
├── packages/                   # Shared packages
│   ├── shared-types/           # TypeScript types
│   ├── shared-ui/              # Shared React components
│   └── webrtc-core/            # WebRTC utilities
│
├── docs/                       # Documentation
├── .github/
│   └── workflows/              # CI/CD pipelines
├── package.json                # Root workspace config
├── pnpm-workspace.yaml
└── turbo.json                  # Turborepo config
```

## Data Flow Architecture

### Session Establishment Flow

```mermaid
sequenceDiagram
    participant Host as Host Desktop
    participant Supabase as Supabase Realtime
    participant Viewer as Viewer Browser

    Host->>Supabase: Authenticate
    Host->>Supabase: Create session record
    Supabase-->>Host: Session ID + Join Link

    Note over Host: Host shares join link

    Viewer->>Supabase: Open join link
    Viewer->>Supabase: Authenticate or join as guest
    Viewer->>Supabase: Subscribe to session channel

    Host->>Supabase: Broadcast WebRTC offer
    Supabase-->>Viewer: Receive offer
    Viewer->>Supabase: Broadcast WebRTC answer
    Supabase-->>Host: Receive answer

    Note over Host,Viewer: ICE candidate exchange via Supabase Realtime

    Host->>Viewer: Direct WebRTC connection established
    Host->>Viewer: Video stream begins
```

### Remote Control Flow

```mermaid
sequenceDiagram
    participant Viewer as Viewer Browser
    participant DataChannel as WebRTC DataChannel
    participant Host as Host Desktop
    participant NutJS as nut.js Input Injector

    Note over Viewer: Viewer is in view-only mode

    Viewer->>DataChannel: Request control
    DataChannel->>Host: Control request received
    Host->>Host: Show approval dialog
    Host->>DataChannel: Control granted
    DataChannel->>Viewer: Control state: granted

    Note over Viewer: Viewer can now send input

    Viewer->>DataChannel: Mouse move event
    DataChannel->>Host: Receive input event
    Host->>NutJS: Inject mouse movement

    Viewer->>DataChannel: Keyboard event
    DataChannel->>Host: Receive input event
    Host->>NutJS: Inject keypress

    Note over Host: Host presses emergency revoke hotkey

    Host->>DataChannel: Control revoked
    DataChannel->>Viewer: Control state: revoked
```

## Component Responsibilities

### Desktop App - Electron Main Process

| Component              | Responsibility                                       |
| ---------------------- | ---------------------------------------------------- |
| `SessionManager`       | Create/end sessions, manage session state            |
| `ScreenCaptureManager` | Handle screen/window selection, capture frames       |
| `WebRTCManager`        | Manage peer connections, media tracks, data channels |
| `InputInjector`        | Receive remote input, inject via nut.js              |
| `PermissionManager`    | Request/verify OS permissions                        |
| `ControlStateManager`  | Manage control grants/revokes per participant        |

### Desktop App - Electron Renderer

| Component         | Responsibility                     |
| ----------------- | ---------------------------------- |
| `HostUI`          | Main host interface                |
| `ScreenSelector`  | Screen/window picker UI            |
| `ParticipantList` | Show connected participants        |
| `ControlPanel`    | Grant/revoke control UI            |
| `StatusIndicator` | Show connection and control status |

### Web App - Marketing

| Component      | Responsibility                     |
| -------------- | ---------------------------------- |
| `LandingPage`  | Hero, value proposition            |
| `FeaturesPage` | Feature showcase                   |
| `DownloadPage` | OS detection, install instructions |
| `DocsPage`     | FAQ, documentation                 |

### Web App - Viewer/Join UI

| Component          | Responsibility                            |
| ------------------ | ----------------------------------------- |
| `JoinPage`         | Session join flow                         |
| `ViewerCanvas`     | Render remote screen                      |
| `InputCapture`     | Capture mouse/keyboard for remote control |
| `CursorOverlay`    | Show multi-cursor positions               |
| `ControlRequestUI` | Request/status of control                 |

## Network Architecture

```mermaid
graph LR
    subgraph Internet
        STUN[STUN Server<br/>stun.l.google.com]
        TURN[Self-hosted TURN<br/>coturn]
    end

    subgraph HostNetwork [Host Network]
        HostApp[PairUX Desktop]
    end

    subgraph ViewerNetwork [Viewer Network]
        ViewerBrowser[Browser Viewer]
    end

    HostApp <--> |ICE Candidates| STUN
    ViewerBrowser <--> |ICE Candidates| STUN

    HostApp <--> |Relay if needed| TURN
    ViewerBrowser <--> |Relay if needed| TURN

    HostApp <-.-> |Direct P2P if possible| ViewerBrowser
```

## Security Boundaries

```mermaid
graph TB
    subgraph TrustBoundary1 [Host Machine - Full Trust]
        HostApp[PairUX Desktop App]
        OSPerms[OS Permissions<br/>Screen Recording + Accessibility]
    end

    subgraph TrustBoundary2 [Encrypted Channel]
        WebRTC[WebRTC DTLS/SRTP]
    end

    subgraph TrustBoundary3 [Viewer - Limited Trust]
        ViewerApp[Browser Viewer]
        ControlState[Control State<br/>Host-controlled]
    end

    subgraph TrustBoundary4 [Backend - Auth Only]
        Supabase[Supabase]
        NoMedia[No media passes through]
    end

    HostApp --> OSPerms
    HostApp <--> WebRTC
    WebRTC <--> ViewerApp
    ViewerApp --> ControlState

    HostApp <--> |Auth + Signaling only| Supabase
    ViewerApp <--> |Auth + Signaling only| Supabase
```

## Key Design Decisions

1. **Electron for Desktop**: Required for native screen capture and input injection. No pure web alternative exists for host functionality.

2. **WebRTC for Media**: Industry standard for low-latency peer-to-peer video. Provides built-in encryption.

3. **Supabase Realtime for Signaling**: Eliminates need for custom signaling server. Provides auth integration.

4. **nut.js for Input Injection**: Cross-platform input automation. Handles mouse, keyboard, and screen coordinates.

5. **Self-hosted TURN**: Full control over relay infrastructure. Required for NAT traversal in restrictive networks.

6. **Monorepo with Turborepo**: Shared code between web and desktop. Unified CI/CD. Better developer experience.

## Performance Targets

| Metric             | Target        | Measurement                                    |
| ------------------ | ------------- | ---------------------------------------------- |
| End-to-end latency | <150ms        | Time from host screen change to viewer display |
| Input latency      | <100ms        | Time from viewer input to host injection       |
| Video quality      | 1080p @ 30fps | Adaptive based on bandwidth                    |
| Connection time    | <10s          | From join click to video display               |
| Reconnection time  | <5s           | After network interruption                     |

## Next Steps

See the following documents for detailed specifications:

- [FEATURES.md](./FEATURES.md) - Feature specifications
- [TECH-STACK.md](./TECH-STACK.md) - Technology choices
- [WEBRTC-FLOW.md](./WEBRTC-FLOW.md) - WebRTC implementation details
- [SCALING-ARCHITECTURE.md](./SCALING-ARCHITECTURE.md) - Scaling strategy and cost implications
- [REMOTE-CONTROL.md](./REMOTE-CONTROL.md) - Input injection system
- [SECURITY.md](./SECURITY.md) - Security model
- [DISTRIBUTION.md](./DISTRIBUTION.md) - Package distribution
- [CI-CD.md](./CI-CD.md) - CI/CD pipelines
