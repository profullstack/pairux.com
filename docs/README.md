# PairUX Documentation

Welcome to the PairUX documentation. This folder contains comprehensive technical documentation for the PairUX collaborative screen sharing application.

## Documentation Index

| Document                                 | Description                                |
| ---------------------------------------- | ------------------------------------------ |
| [ARCHITECTURE.md](./ARCHITECTURE.md)     | System architecture overview with diagrams |
| [FEATURES.md](./FEATURES.md)             | Detailed feature specifications            |
| [TECH-STACK.md](./TECH-STACK.md)         | Technology choices and rationale           |
| [WEBRTC-FLOW.md](./WEBRTC-FLOW.md)       | WebRTC signaling and media flow            |
| [REMOTE-CONTROL.md](./REMOTE-CONTROL.md) | Input injection and control state machine  |
| [SECURITY.md](./SECURITY.md)             | Security model and permissions             |
| [DISTRIBUTION.md](./DISTRIBUTION.md)     | Package manager publishing guide           |
| [CI-CD.md](./CI-CD.md)                   | GitHub Actions workflow specifications     |
| [API.md](./API.md)                       | Supabase schema and API contracts          |

## Quick Links

### For Developers

- Start with [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview
- See [TECH-STACK.md](./TECH-STACK.md) for technology decisions
- Review [API.md](./API.md) for database schema and API contracts

### For DevOps

- See [CI-CD.md](./CI-CD.md) for GitHub Actions workflows
- Review [DISTRIBUTION.md](./DISTRIBUTION.md) for package manager setup

### For Security Review

- See [SECURITY.md](./SECURITY.md) for security model
- Review [WEBRTC-FLOW.md](./WEBRTC-FLOW.md) for encryption details

## Project Structure

```
pairux/
├── apps/
│   ├── web/          # Next.js marketing site + viewer UI
│   └── desktop/      # Electron desktop host application
├── packages/
│   ├── shared-types/ # TypeScript type definitions
│   ├── shared-ui/    # Shared React components
│   └── webrtc-core/  # WebRTC utilities
├── docs/             # This documentation
└── .github/
    └── workflows/    # CI/CD pipelines
```

## Getting Started

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Start development:
   - Web: `pnpm --filter @pairux/web dev`
   - Desktop: `pnpm --filter @pairux/desktop dev`

## Contributing

Please read the documentation before contributing. Key areas:

1. Follow the architecture patterns in [ARCHITECTURE.md](./ARCHITECTURE.md)
2. Ensure security requirements from [SECURITY.md](./SECURITY.md)
3. Test WebRTC flows per [WEBRTC-FLOW.md](./WEBRTC-FLOW.md)
