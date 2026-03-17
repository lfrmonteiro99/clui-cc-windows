# Windows Support Guide — Clui CC

## Support Policy

- **Supported:** Windows 10 (build 1903+), Windows 11
- **Architecture:** x64, arm64
- **Node.js:** 20.x, 22.x LTS
- **Claude Code CLI:** 2.1+

## Prerequisites

| Requirement | Install Command |
|-------------|----------------|
| Node.js 20+ LTS | `winget install OpenJS.NodeJS.LTS` |
| Python 3.12+ | `winget install Python.Python.3.12` |
| Python setuptools | `pip install setuptools` |
| VS Build Tools | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"` |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |

Run `npm run doctor:win` to check all prerequisites.

## Quick Start

```powershell
git clone https://github.com/lfrmonteiro99/clui-cc-windows.git
cd clui-cc-windows
npm run doctor:win       # check prerequisites
npm install              # install dependencies
npm run dev              # start dev mode
```

Toggle the overlay with **Ctrl+Space** (configurable — see below).

## Windows-Specific Notes

### Global Shortcut
Default: `Ctrl+Space`. If this conflicts with your IME or PowerToys, the app auto-falls back to alternatives (`Ctrl+Shift+Space`, `Ctrl+\``, etc.). The chosen shortcut persists across launches in `~/.claude/clui-shortcut.json`.

### Transparency / Overlay
The app uses a transparent, always-on-top window. On some GPU drivers, this may cause visual artifacts. If you experience issues, the app supports an opaque fallback mode.

### Terminal Launch
Supports cmd.exe (default), PowerShell, and Windows Terminal. The terminal provider can be configured in settings.

### Screenshots
Full-screen capture via PowerShell System.Drawing. Interactive region selection is not yet available on Windows (macOS uses `screencapture -i`).

### Voice Transcription
Whisper binary is detected from: scoop shims, `%LOCALAPPDATA%\Programs`, `%PROGRAMFILES%`, and PATH. Install via `scoop install whisper-cpp` or download from [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases).

### Session Paths
Sessions are stored in `~/.claude/projects/<encoded-path>/`. The encoding replaces `\`, `/`, and `:` with `-`. For example: `C:\Users\me\project` → `C--Users-me-project`.

### node-pty
Required for PTY transport (interactive permissions). If `node-pty` fails to load, the app falls back to stdio-only mode. Rebuild with: `npm rebuild node-pty`.

## Known Limitations

- Screenshot captures full screen (no region select)
- Voice transcription requires manual Whisper installation
- node-pty may require VS Build Tools for compilation
- Transparency may have artifacts on some GPU/driver combinations

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails on node-pty | Install VS Build Tools: `winget install Microsoft.VisualStudio.2022.BuildTools` |
| Shortcut doesn't work | Check for IME/PowerToys conflicts. Edit `~/.claude/clui-shortcut.json` |
| App invisible after toggle | Press `Ctrl+Shift+K` (secondary shortcut) |
| Sessions not found | Verify path encoding matches CLI: check `~/.claude/projects/` |
| Build fails | Run `npm run doctor:win` for diagnostics |

## Distribution

Windows installers are built via `npm run dist:win`:
- **NSIS installer** — standard Windows installer with custom install directory
- **Portable** — single `.exe`, no installation required
