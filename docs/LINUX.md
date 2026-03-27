# Linux Support Guide

## Prerequisites

- **Node.js 18+** (20 LTS recommended)
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`)
- **Build tools** for node-pty native compilation:
  - Debian/Ubuntu: `sudo apt install build-essential python3-dev`
  - Fedora: `sudo dnf install gcc gcc-c++ make python3-devel`
  - Arch/CachyOS: `sudo pacman -S base-devel`

## Quick Start

```bash
npm install
npm run dev
```

The overlay toggles with `Ctrl+Space` by default (configurable via the command palette).

## Known Limitations

- **Global shortcuts** may not work on GNOME Wayland (Wayland does not allow apps to grab global keys without a portal).
- **System tray** requires the AppIndicator extension on GNOME (`gnome-shell-extension-appindicator`).
- **Screenshot** capture requires `spectacle`, `flameshot`, or `scrot` installed and available on `$PATH`.
- **Voice input** requires manual `whisper-cpp` installation; there is no automatic setup on Linux.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `@tailwindcss/oxide` build error | Should auto-resolve on `npm install`. If not: `npm install @tailwindcss/oxide-linux-x64-gnu` |
| `crypto.getRandomValues is not a function` | Upgrade to Node.js 18+ (the app requires the Web Crypto API) |
| node-pty build failure | Install build tools: `build-essential` (Debian/Ubuntu), `gcc gcc-c++ make` (Fedora), or `base-devel` (Arch) |
| No tray icon on GNOME | Install the AppIndicator extension: `sudo apt install gnome-shell-extension-appindicator` (Debian/Ubuntu) or equivalent, then enable it in GNOME Extensions |
| Global shortcut not working on Wayland | Use X11 session, or bind the toggle shortcut through your DE's own settings |
| Blank window on Wayland | Try launching with `--ozone-platform-hint=auto` or `--enable-features=UseOzonePlatform --ozone-platform=wayland` |

## Supported Desktop Environments

| DE | Shortcuts | Tray | Screenshot | Terminal |
|----|-----------|------|------------|----------|
| KDE (X11/Wayland) | Full | Full | spectacle | konsole |
| GNOME (X11) | Full | Extension needed | gnome-screenshot | gnome-terminal |
| GNOME (Wayland) | Limited | Extension needed | gnome-screenshot | gnome-terminal |
| XFCE | Full | Full | scrot | xfce4-terminal |
| i3/Sway | Bind manually | N/A | scrot/grim | user configured |

## Debug Logging

To enable verbose debug logging:

```bash
CLUI_DEBUG=1 npm run dev
```

Logs are written to `~/.clui-debug.log` and include IPC traces and error details.
