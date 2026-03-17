# CLUI Open-Source Readiness Report

**Date:** 2026-03-12
**Branch:** `oss-prep`
**Assessor:** Automated scan + manual review

---

## 1. Security

### Secrets & Credentials
| Check | Result | Severity |
|-------|--------|----------|
| Hardcoded API keys/tokens | None found | Safe |
| .env files | None exist (not needed — app uses local CLI) | Safe |
| CLAUDECODE env var | Explicitly deleted from spawned processes | Safe |
| Private key / cert files | None found | Safe |
| Database connection strings | None (no DB) | Safe |

### Permission System
- HTTP hook server binds **127.0.0.1:19836 only** (not exposed externally)
- Per-launch app secret (randomUUID) prevents local spoofing
- Per-run tokens for routing
- Sensitive fields masked before sending to renderer (`/token|password|secret|key|auth|credential|api.?key/i`)
- 5-minute auto-deny timeout for unanswered permission requests

**Verdict:** No security blockers.

---

## 2. Privacy

### Hardcoded Paths
| Location | Contains User Paths | Action |
|----------|-------------------|--------|
| `src/**` | No | Safe |
| `spike/**` | No | Safe |
| `scripts/**` | No (uses `$(dirname "$0")`) | Safe |
| `docs/protocol-captures/*.jsonl` | **Yes** — `/Users/<user>/...` in session CWD fields | **Must exclude from public repo** |
| `docs/claude-permission-probe.md` | **Yes** — references local paths in examples | **Must exclude from public repo** |
| `.claude/settings.local.json` | Yes — already gitignored | Safe |

### Personal Information
| Check | Result |
|-------|--------|
| Email addresses in source | None |
| package.json author field | Not set (clean) |
| Git commit author | Will be visible in public repo history — see cutover plan |

**Verdict:** Exclude `docs/protocol-captures/` and `docs/claude-permission-probe.md` from public repo.

---

## 3. Licensing

### Project License
- **Current state:** MIT LICENSE file present in repo root
- **Status:** Resolved

### Dependencies (all MIT-compatible)
| Package | License | Copyleft Risk |
|---------|---------|---------------|
| electron | MIT | None |
| react / react-dom | MIT | None |
| zustand | MIT | None |
| framer-motion | MIT | None |
| node-pty | MIT | None |
| react-markdown | MIT | None |
| remark-gfm | MIT | None |
| @phosphor-icons/react | MIT | None |
| tailwindcss | MIT | None |
| All devDependencies | MIT | None |

**No GPL, AGPL, SSPL, or BUSL dependencies detected.**

### Assets
| Asset | Provenance | Action |
|-------|-----------|--------|
| `resources/icon.*` | Original (created for project) | Document in LICENSE |
| `resources/notification.mp3` | Replaced with generated CC0 chime (embedded metadata) | Resolved |
| `resources/trayTemplate*.png` | Original | Document in LICENSE |
| Root marketing screenshots | Not included in current repo root | Optional to add later if needed for release collateral |

**Verdict:** ~~Add LICENSE file~~ — resolved. ~~Verify notification.mp3 provenance~~ — resolved (replaced with CC0 generated chime).

---

## 4. Developer UX

### Prerequisites for Contributors
- Node.js 18+ (for Electron 33)
- macOS (primary platform — Electron transparent window, tray, node-pty)
- `claude` CLI installed and authenticated (core dependency)
- Optional: `whisper-cli` or `whisper` + model for voice transcription

### Build System
- `npm install` → `npm run dev` (hot-reload) or `npm run build` (production)
- Zero TypeScript errors confirmed
- electron-vite handles main/preload/renderer bundling

### OSS Documentation
| Item | Status | Priority |
|------|--------|----------|
| README.md | Present | Resolved |
| CONTRIBUTING.md | Present | Resolved |
| SECURITY.md | Present | Resolved |
| CODE_OF_CONDUCT.md | Present | Resolved |
| Architecture docs | Present (`docs/ARCHITECTURE.md`) | Resolved |
| .env.example | Not needed | N/A — documented in README |

---

## 5. Repository Hygiene

### Files to Exclude from Public Repo
| Path | Reason | Current Status |
|------|--------|----------------|
| `docs/protocol-captures/` | Contains local paths, session data | Already removed |
| `docs/claude-permission-probe.md` | Contains local path references | Already removed |
| `CLUI-PRD.md` | Internal product requirements | Already removed |
| `CODEX_REPORT_INTERACTIVE_COMMANDS.md` | Internal dev report | Already removed |
| `spike/` | Experimental probes, not production code | Already removed |
| `src/main/probe/` | Internal contract/permission test utilities | Already removed |
| `soft_and_brief_notif_#2-*.mp3` | Stray temp file in root | Already removed |
| `start-pty.command` | Legacy PTY mode launcher | Already removed |
| `.claude/` | Project-scoped Claude settings | Gitignored |

### .gitignore Coverage
Current `.gitignore` now covers all previously identified gaps:
- `out/` (electron-builder output) — present
- `*.log` — present
- `.env*` — present
- `*.swp`, `*.swo` — present
- OS artifacts (`Thumbs.db`, `Desktop.ini`) — present

---

## 6. Network Dependencies

| Endpoint | Purpose | Required | Graceful Offline |
|----------|---------|----------|-----------------|
| `raw.githubusercontent.com/anthropics/*` | Marketplace catalog | Optional | Yes — cached 5min, error state shown |
| `api.github.com/repos/anthropics/*/tarball/*` | Skill auto-install | Optional | Yes — skipped on failure |
| `127.0.0.1:19836` | Permission hook server | Required (local only) | N/A |

No telemetry, analytics, auto-updater, or CDN dependencies.

---

## 7. Release Risk Summary

| Risk | Severity | Status |
|------|----------|--------|
| No LICENSE file | **Critical** | Resolved — MIT LICENSE added |
| No README | **Critical** | Resolved — README.md present |
| Protocol captures contain local paths | **High** | Resolved — excluded from repo |
| notification.mp3 unknown provenance | **Medium** | Resolved — replaced with CC0 generated chime |
| No CONTRIBUTING/SECURITY/COC docs | **Medium** | Resolved — all present |
| Internal docs (PRD, Codex reports) | **Low** | Resolved — excluded from repo |
| Probe utilities in src/main/probe/ | **Low** | Resolved — excluded from repo |
| macOS-only (no Windows/Linux) | **Low** | Documented in README as known limitation |
