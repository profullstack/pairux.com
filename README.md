<p align="center">
  <img src="apps/web/public/favicon.svg" alt="PairUX Logo" width="120" />
</p>

<h1 align="center">PairUX</h1>

<p align="center">
  <strong>Collaborative screen sharing with simultaneous remote control</strong><br>
  Like Screenhero, but open source.
</p>

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

<details>
<summary><strong>macOS</strong></summary>

**Homebrew** (Recommended)

```bash
brew tap profullstack/homebrew-pairux
brew install --cask pairux
```

**Direct Download**

- [PairUX-x.x.x-arm64.dmg](https://github.com/profullstack/pairux.com/releases/latest) (Apple Silicon)
- [PairUX-x.x.x-x64.dmg](https://github.com/profullstack/pairux.com/releases/latest) (Intel)

</details>

<details>
<summary><strong>Windows</strong></summary>

**WinGet** (Recommended)

```powershell
winget install PairUX.PairUX
```

**Scoop**

```powershell
scoop bucket add pairux https://github.com/profullstack/scoop-pairux
scoop install pairux
```

**Chocolatey**

```powershell
choco install pairux
```

**Direct Download**

- [PairUX-x.x.x-x64.exe](https://github.com/profullstack/pairux.com/releases/latest)

</details>

<details>
<summary><strong>Linux (Debian/Ubuntu)</strong></summary>

**APT Repository** (Recommended)

```bash
# Add GPG key
curl -fsSL https://profullstack.github.io/pairux-apt/pairux.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/pairux.gpg] https://profullstack.github.io/pairux-apt stable main" | sudo tee /etc/apt/sources.list.d/pairux.list

# Install
sudo apt update && sudo apt install pairux
```

**Direct Download**

- [pairux_x.x.x_amd64.deb](https://github.com/profullstack/pairux.com/releases/latest)

</details>

<details>
<summary><strong>Linux (Fedora/RHEL/CentOS)</strong></summary>

**RPM Repository** (Recommended)

```bash
# Add repository
sudo dnf config-manager --add-repo https://profullstack.github.io/pairux-rpm/pairux.repo

# Import GPG key
sudo rpm --import https://profullstack.github.io/pairux-rpm/RPM-GPG-KEY-pairux

# Install
sudo dnf install pairux
```

**Direct Download**

- [pairux-x.x.x-1.x86_64.rpm](https://github.com/profullstack/pairux.com/releases/latest)

</details>

<details>
<summary><strong>Linux (Arch)</strong></summary>

**AUR** (Recommended)

```bash
# Using yay
yay -S pairux-bin

# Using paru
paru -S pairux-bin

# Manual
git clone https://aur.archlinux.org/pairux-bin.git
cd pairux-bin
makepkg -si
```

</details>

<details>
<summary><strong>Linux (Gentoo)</strong></summary>

**Custom Overlay**

```bash
# Add overlay
sudo eselect repository add pairux git https://github.com/profullstack/gentoo-pairux.git
sudo emaint sync -r pairux

# Install
sudo emerge net-misc/pairux-bin
```

</details>

<details>
<summary><strong>Linux (NixOS/Nix)</strong></summary>

**Flake** (Recommended)

```bash
nix profile install github:profullstack/pairux-nix
```

**nix-shell**

```bash
nix-shell -p pairux
```

</details>

<details>
<summary><strong>Linux (Universal)</strong></summary>

**AppImage**

```bash
# Download
wget https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-x.x.x-x86_64.AppImage

# Make executable
chmod +x PairUX-*.AppImage

# Run
./PairUX-*.AppImage
```

</details>

### CLI Usage

Once installed, the `pairux` command is available in your terminal:

```bash
pairux                # Launch the desktop app
pairux update         # Check for updates and install the latest version
pairux uninstall      # Remove PairUX completely
pairux --version      # Show installed version
pairux --help         # Show help
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

| Feature               | Description                                   |
| --------------------- | --------------------------------------------- |
| **E2E Encryption**    | All media encrypted via WebRTC DTLS-SRTP      |
| **No Server Storage** | Screen data never touches our servers         |
| **Explicit Consent**  | Host must approve all control requests        |
| **Emergency Revoke**  | `Ctrl+Shift+Escape` instantly revokes control |
| **Visual Indicators** | Always shows when remote control is active    |
| **Code Signed**       | All builds are signed and notarized           |

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

| Component    | Technology                            |
| ------------ | ------------------------------------- |
| Desktop App  | Electron + React + nut.js             |
| Web/PWA      | Next.js 16.2 + Tailwind + shadcn/ui   |
| Backend      | Supabase (Auth, Realtime, PostgreSQL) |
| Media        | WebRTC (native P2P)                   |
| TURN Server  | coturn (self-hosted)                  |
| Build System | pnpm + Turborepo                      |
| CI/CD        | GitHub Actions                        |

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
git clone https://github.com/profullstack/pairux.com.git
cd pairux

# Install dependencies
pnpm install

# Start development
pnpm dev
```

### Commands

| Command                             | Description                        |
| ----------------------------------- | ---------------------------------- |
| `pnpm dev`                          | Start all apps in development mode |
| `pnpm build`                        | Build all apps for production      |
| `pnpm lint`                         | Run linting                        |
| `pnpm test`                         | Run tests                          |
| `pnpm --filter @pairux/web dev`     | Start web app only                 |
| `pnpm --filter @pairux/desktop dev` | Start desktop app only             |

---

## 📖 Documentation

| Document                                 | Description                     |
| ---------------------------------------- | ------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)     | System design and diagrams      |
| [Features](docs/FEATURES.md)             | Detailed feature specifications |
| [Tech Stack](docs/TECH-STACK.md)         | Technology choices              |
| [WebRTC Flow](docs/WEBRTC-FLOW.md)       | Signaling and media flow        |
| [Remote Control](docs/REMOTE-CONTROL.md) | Input injection system          |
| [Security](docs/SECURITY.md)             | Security model                  |
| [Distribution](docs/DISTRIBUTION.md)     | Package manager publishing      |
| [CI/CD](docs/CI-CD.md)                   | GitHub Actions workflows        |
| [API](docs/API.md)                       | Database schema and API         |

---

## 🗺️ Roadmap

### MVP (v1.0)

- [x] Documentation and architecture
- [x] Monorepo setup
- [x] Marketing website
- [x] Desktop host app
- [x] PWA viewer
- [x] Screen sharing
- [x] Remote control
- [x] Package manager distribution
- [x] Multi-viewer support (up to 5 for p2p, 100k for SFU)
- [x] Session recording
- [x] Chat and annotations

### Future

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
