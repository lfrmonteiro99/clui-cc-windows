# Linux Support Guide

Linux support covers 11 tracked issues (LINUX-001 through LINUX-011) and is in beta. Both X11 and Wayland sessions are supported, with Wayland-specific workarounds where needed.

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

## Distribution

Linux builds are configured via electron-builder and produce:

- **AppImage** — portable, works on most distros
- **deb** — Debian/Ubuntu package
- **rpm** — Fedora/RHEL package

Build with `npm run dist:linux` (or the platform-appropriate dist script).

## Features Working on Linux

- Multi-tab sessions with drag-to-reorder
- Command palette, snippets, workflows
- Terminal launch detection (auto-detects Konsole, Alacritty, Kitty, gnome-terminal, xfce4-terminal, wezterm, xterm, or `$TERMINAL` env var)
- Screenshot capture with Wayland awareness (spectacle, gnome-screenshot, flameshot, scrot on X11, grim on Wayland)
- Global shortcut with Wayland fallback (graceful degradation instead of crash)
- Multi-workspace visibility (always-on-visible-workspace)
- Tray icon with GNOME AppIndicator fallback
- Fish shell detection and support
- Claude binary path resolution (`~/.npm-global/bin/claude`, `/usr/local/bin/claude`, `$PATH`)
- Context menu "Show in File Manager" (uses `xdg-open`)
- Whisper voice input (manual install; no auto-provisioner on Linux)
- Cost tracking, diff viewer, permission approval, marketplace
- Dark/light/system theme (3-way selector)

## Wayland-Specific Behavior

### Click-Through Disabled (LINUX-011)

On Wayland, Electron's `setIgnoreMouseEvents({ forward: true })` causes the entire window to become unclickable. The app detects Wayland sessions via `isWaylandSession()` (checks `XDG_SESSION_TYPE` and `WAYLAND_DISPLAY`) and disables click-through forwarding. This means the overlay captures all mouse events on Wayland instead of forwarding clicks to windows behind it.

### Global Shortcut Fallback

Wayland compositors do not support X11-style global keybindings. The app uses `registerGlobalShortcutSafe()` which catches the registration failure and logs a warning instead of crashing. Use the tray icon or bind the toggle through your DE's own shortcut settings.

### Screenshot Tool Selection

On Wayland, X11-only tools like `scrot` are skipped. The app prefers `spectacle`, `gnome-screenshot`, or `flameshot` (which support both), and falls back to `grim` (Wayland-native) when available.

## Known Limitations

- **Global shortcuts** may not work on GNOME Wayland (Wayland does not allow apps to grab global keys without a portal). Use tray icon or DE shortcut binding.
- **System tray** requires the AppIndicator extension on GNOME (`gnome-shell-extension-appindicator`).
- **Screenshot** capture requires one of: `spectacle`, `gnome-screenshot`, `flameshot`, `scrot` (X11), or `grim` (Wayland) on `$PATH`.
- **Voice input** requires manual `whisper-cpp` installation; the auto-provisioner does not run on Linux.
- **Click-through** is disabled on Wayland (see above).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `@tailwindcss/oxide` build error | Should auto-resolve on `npm install`. The `@tailwindcss/oxide-linux-x64-gnu` binding is in `optionalDependencies`. If it still fails: `npm install @tailwindcss/oxide-linux-x64-gnu` |
| `crypto.getRandomValues is not a function` | Upgrade to Node.js 18+ (the app requires the Web Crypto API) |
| node-pty build failure | Install build tools: `build-essential` (Debian/Ubuntu), `gcc gcc-c++ make` (Fedora), or `base-devel` (Arch) |
| No tray icon on GNOME | Install the AppIndicator extension: `sudo apt install gnome-shell-extension-appindicator` (Debian/Ubuntu) or equivalent, then enable it in GNOME Extensions |
| Global shortcut not working on Wayland | Use X11 session, or bind the toggle shortcut through your DE's own settings. The app logs a warning when shortcut registration fails on Wayland |
| Blank window on Wayland | Try launching with `--ozone-platform-hint=auto` or `--enable-features=UseOzonePlatform --ozone-platform=wayland` |
| App unclickable on Wayland | This was LINUX-011, now fixed. Click-through is disabled on Wayland. If still occurring, verify you have the latest build |
| Terminal launch fails | Check that at least one supported terminal is on `$PATH`. Set `$TERMINAL` to override detection |
| Screenshot fails silently | Ensure one of spectacle/gnome-screenshot/flameshot/scrot/grim is installed. Run `CLUI_DEBUG=1 npm run dev` to see which tool was selected |

## Supported Desktop Environments

| DE | Shortcuts | Tray | Screenshot | Terminal |
|----|-----------|------|------------|----------|
| KDE (X11/Wayland) | Full | Full | spectacle | konsole |
| GNOME (X11) | Full | Extension needed | gnome-screenshot | gnome-terminal |
| GNOME (Wayland) | Limited (fallback) | Extension needed | gnome-screenshot | gnome-terminal |
| XFCE | Full | Full | scrot | xfce4-terminal |
| i3/Sway | Bind manually | N/A | scrot/grim | user configured |
| Hyprland | Bind manually | N/A | grim | user configured |

## Key Source Files

| File | Purpose |
|------|---------|
| `src/main/linux-support.ts` | Wayland detection, global shortcut fallback |
| `src/main/terminal-launch.ts` | Terminal emulator auto-detection |
| `src/main/screenshot.ts` | Screenshot tool detection (Wayland-aware) |
| `tests/unit/linux-support.test.ts` | Wayland detection tests |
| `tests/unit/linux-platform.test.ts` | Platform entrypoint tests |
| `tests/unit/linux-build-config.test.ts` | electron-builder config tests |
| `tests/unit/linux-context-menu.test.ts` | File manager integration tests |
| `tests/unit/linux-whisper.test.ts` | Whisper provisioner guard tests |
| `src/main/__tests__/terminal-launch-linux.test.ts` | Terminal detection tests |
| `tests/unit/screenshot.test.ts` | Screenshot tool tests |

## Debug Logging

To enable verbose debug logging:

```bash
CLUI_DEBUG=1 npm run dev
```

Logs are written to `~/.clui-debug.log` and include IPC traces and error details.
