# PairUX

**Collaborative screen sharing with simultaneous remote control** — like Screenhero, but open source.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## ✨ Features

- 🖥️ **Real-time screen sharing** — Low-latency WebRTC streaming
- 🎮 **Remote control** — Mouse + keyboard with explicit host approval
- 👥 **Simultaneous input** — Host and viewer can control at the same time
- 🔒 **Secure by design** — E2E encrypted, media never touches servers
- 🌐 **PWA Viewer** — Join sessions from any browser, installable as an app
- 💻 **Cross-platform** — macOS, Windows, Linux desktop apps
- 📦 **Easy install** — Available via Homebrew, WinGet, APT, and more

---

## 🚀 Quick Start

### Install the Desktop App (Host)

**macOS**
```bash
brew install --cask pairux
```

**Windows**
```powershell
winget install PairUX.PairUX
```

**Linux (Debian/Ubuntu)**
```bash
curl -fsSL https://pairux.com/apt/pairux.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux.gpg
echo "deb [signed-by=/usr/share/keyrings/pairux.gpg] https://pairux.com/apt stable main" | sudo tee /etc/apt/sources.list.d/pairux.list
sudo apt update && sudo apt install pairux
```

**Linux (Fedora)**
```bash
sudo dnf config-manager --add-repo https://pairux.com/rpm/pairux.repo
sudo dnf install pairux
```

**Linux (Arch)**
```bash
yay -S pairux-bin
```

### Join as a Viewer (No Install Required!)

Just open the session link in any modern browser. The viewer is a **Progressive Web App (PWA)** — you can install it for quick access without downloading anything.

---

## 🎯 How It Works

```
┌─────────────────┐                      ┌─────────────────┐
│   Host          │                      │   Viewer        │
│   (Desktop App) │◄────── WebRTC ──────►│   (PWA/Browser) │
│                 │        P2P           │                 │
│   Shares screen │                      │   Views screen  │
│   Grants control│                      │   Requests ctrl │
└─────────────────┘                      └─────────────────┘
         │                                        │
         │         Auth + Signaling only          │
         └──────────────┬─────────────────────────┘
                        ▼
               ┌─────────────────┐
               │    Supabase     │
               │  (No media!)    │
               └─────────────────┘
```

1. **Host** starts a session in the desktop app
2. **Host** shares the join link with a viewer
3. **Viewer** opens the link in their browser (or installed PWA)
4. **WebRTC** establishes a direct P2P connection
5. **Viewer** can request control, **Host** approves
6. Both can control simultaneously — **Host always has priority**

---

## 🔐 Security

| Feature | Description |
|---------|-------------|
| **E2E Encryption** | All media encrypted via WebRTC DTLS-SRTP |
| **No Server Storage** | Screen data never touches our servers |
| **Explicit Consent** | Host must approve all control requests |
| **Emergency Revoke** | `Ctrl+Shift+Escape` instantly revokes control |
| **Visual Indicators** | Always shows when remote control is active |
| **Code Signed** | All builds are signed and notarized |

---

## 📱 PWA Viewer

The web viewer is a **Progressive Web App** that can be installed on any device:

- ✅ **No download required** — Works in any modern browser
- ✅ **Installable** — Add to home screen for app-like experience
- ✅ **Offline capable** — Core UI works offline
- ✅ **Mobile friendly** — View sessions from phone/tablet
- ✅ **Auto-updates** — Always the latest version

### Install the PWA

1. Open a session link in Chrome, Edge, or Safari
2. Click "Install" in the browser menu (or address bar icon)
3. Launch PairUX Viewer from your apps

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop App | Electron + React + nut.js |
| Web/PWA | Next.js 16.2 + Tailwind + shadcn/ui |
| Backend | Supabase (Auth, Realtime, PostgreSQL) |
| Media | WebRTC (native P2P) |
| TURN Server | coturn (self-hosted) |
| Build System | pnpm + Turborepo |
| CI/CD | GitHub Actions |

---

## 📁 Project Structure

```
pairux/
├── apps/
│   ├── web/                 # Next.js marketing site + PWA viewer
│   └── desktop/             # Electron host application
├── packages/
│   ├── shared-types/        # TypeScript type definitions
│   └── webrtc-core/         # WebRTC utilities
├── docs/                    # Technical documentation
├── plans/                   # Implementation plans
└── .github/workflows/       # CI/CD pipelines
```

---

## 🧑‍💻 Development

### Prerequisites

- Node.js 24+
- pnpm 9+

### Setup

```bash
# Clone the repo
git clone https://github.com/pairux/pairux.git
cd pairux

# Install dependencies
pnpm install

# Start development
pnpm dev
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps for production |
| `pnpm lint` | Run linting |
| `pnpm test` | Run tests |
| `pnpm --filter @pairux/web dev` | Start web app only |
| `pnpm --filter @pairux/desktop dev` | Start desktop app only |

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design and diagrams |
| [Features](docs/FEATURES.md) | Detailed feature specifications |
| [Tech Stack](docs/TECH-STACK.md) | Technology choices |
| [WebRTC Flow](docs/WEBRTC-FLOW.md) | Signaling and media flow |
| [Remote Control](docs/REMOTE-CONTROL.md) | Input injection system |
| [Security](docs/SECURITY.md) | Security model |
| [Distribution](docs/DISTRIBUTION.md) | Package manager publishing |
| [CI/CD](docs/CI-CD.md) | GitHub Actions workflows |
| [API](docs/API.md) | Database schema and API |

---

## 🗺️ Roadmap

### MVP (v1.0)
- [x] Documentation and architecture
- [ ] Monorepo setup
- [ ] Marketing website
- [ ] Desktop host app
- [ ] PWA viewer
- [ ] Screen sharing
- [ ] Remote control
- [ ] Package manager distribution

### Future
- [ ] Multi-viewer support (up to 5)
- [ ] Session recording
- [ ] Chat and annotations
- [ ] File transfer
- [ ] Mobile viewer app

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Inspired by [Screenhero](https://screenhero.com) (RIP)
- Built with [Electron](https://electronjs.org), [Next.js](https://nextjs.org), [Supabase](https://supabase.com)
- UI components from [shadcn/ui](https://ui.shadcn.com)

---

<p align="center">
  <strong>PairUX</strong> — Pair programming, reimagined.
</p>
