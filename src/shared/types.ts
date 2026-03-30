// ─── Claude Code Stream Event Types (verified from v2.1.63) ───

export interface InitEvent {
  type: 'system'
  subtype: 'init'
  cwd: string
  session_id: string
  tools: string[]
  mcp_servers: Array<{ name: string; status: string }>
  model: string
  permissionMode: string
  agents: string[]
  skills: string[]
  plugins: string[]
  claude_code_version: string
  fast_mode_state: string
  uuid: string
}

export interface StreamEvent {
  type: 'stream_event'
  event: StreamSubEvent
  session_id: string
  parent_tool_use_id: string | null
  uuid: string
}

export type StreamSubEvent =
  | { type: 'message_start'; message: AssistantMessagePayload }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null }; usage: UsageData; context_management?: unknown }
  | { type: 'message_stop' }

export interface ContentBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export type ContentDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }

export interface AssistantEvent {
  type: 'assistant'
  message: AssistantMessagePayload
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

export interface AssistantMessagePayload {
  model: string
  id: string
  role: 'assistant'
  content: ContentBlock[]
  stop_reason: string | null
  usage: UsageData
}

export interface RateLimitEvent {
  type: 'rate_limit_event'
  rate_limit_info: {
    status: string
    resetsAt: number
    rateLimitType: string
  }
  session_id: string
  uuid: string
}

export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  is_error: boolean
  duration_ms: number
  num_turns: number
  result: string
  total_cost_usd: number
  session_id: string
  usage: UsageData & {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  permission_denials: string[]
  uuid: string
}

export interface UsageData {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  service_tier?: string
}

export interface PermissionEvent {
  type: 'permission_request'
  tool: { name: string; description?: string; input?: Record<string, unknown> }
  question_id: string
  options: Array<{ id: string; label: string; kind?: string }>
  session_id: string
  uuid: string
}

// Union of all possible top-level events
export type ClaudeEvent = InitEvent | StreamEvent | AssistantEvent | RateLimitEvent | ResultEvent | PermissionEvent | UnknownEvent

export interface UnknownEvent {
  type: string
  [key: string]: unknown
}

// ─── Tab Groups ───

export interface TabGroup {
  id: string
  name: string
  color?: 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'pink'
  collapsed: boolean
  order: number
}

// ─── Tab State Machine (v2 — from execution plan) ───

export type TabStatus = 'connecting' | 'idle' | 'running' | 'completed' | 'failed' | 'dead'

export interface PermissionRequest {
  questionId: string
  toolTitle: string
  toolDescription?: string
  toolInput?: Record<string, unknown>
  options: Array<{ optionId: string; kind?: string; label: string }>
}

export interface RetryState {
  isRetrying: boolean
  attempt: number
  maxAttempts: number
  nextRetryAt: number | null
  lastError?: string
  exhausted?: boolean
  stopped?: boolean
}

export interface AgentAssignment {
  tabId: string
  agentLabel: string
  projectPath: string
  workKey?: string
  summary: string
  status: 'active' | 'done'
  startedAt: string
  updatedAt: string
  doneAt?: string
  note?: string
}

export interface AgentMemorySnapshot {
  projectPath: string
  active: AgentAssignment[]
  recentDone: AgentAssignment[]
}

export type AgentMemoryClaimResult =
  | { ok: true; snapshot: AgentMemorySnapshot; assignment: AgentAssignment }
  | { ok: false; snapshot: AgentMemorySnapshot; conflict: AgentAssignment }

// ─── Agent Configuration ───

export interface AgentConfig {
  name: string
  description?: string
  prompt?: string
  model?: string
  tools?: string[]
}

export interface Attachment {
  id: string
  type: 'image' | 'file'
  name: string
  path: string
  mimeType?: string
  /** Base64 data URL for image previews */
  dataUrl?: string
  /** File size in bytes */
  size?: number
  /** True when injected from per-project auto-attach config */
  autoAttached?: boolean
}

export interface AutoAttachConfig {
  projectPath: string
  files: string[]
}

export interface AutoAttachState {
  config: AutoAttachConfig
  attachments: Attachment[]
  warnings: string[]
}

export interface TabState {
  id: string
  claudeSessionId: string | null
  status: TabStatus
  activeRequestId: string | null
  hasUnread: boolean
  currentActivity: string
  permissionQueue: PermissionRequest[]
  /** Fallback card when tools were denied and no interactive permission is available */
  permissionDenied: { tools: Array<{ toolName: string; toolUseId: string }> } | null
  retryState: RetryState | null
  agentAssignment: AgentAssignment | null
  lastRunOptions: RunOptions | null
  queuedRunOptions: RunOptions[]
  attachments: Attachment[]
  messages: Message[]
  title: string
  /** Last run's result data (cost, tokens, duration) */
  lastResult: RunResult | null
  /** Session metadata from init event */
  sessionModel: string | null
  sessionTools: string[]
  sessionMcpServers: Array<{ name: string; status: string }>
  sessionSkills: string[]
  sessionVersion: string | null
  /** Prompts waiting behind the current run (display text only) */
  queuedPrompts: string[]
  /** Working directory for this tab's Claude sessions */
  workingDirectory: string
  /** Whether the user explicitly chose a directory (vs. using default home) */
  hasChosenDirectory: boolean
  /** Extra directories accessible via --add-dir (session-preserving) */
  additionalDirs: string[]
  /** Tab group this tab belongs to (undefined = ungrouped) */
  groupId?: string
  /** Runtime environment for this tab's Claude sessions */
  runtime: 'native' | 'wsl'
  /** WSL distribution name (only set when runtime is 'wsl') */
  wslDistro: string | null
  /** Timestamp of last meaningful activity (message, event) — used for freshness indicator */
  lastActivityAt: number
  /** Sandbox mode state for this tab */
  sandboxState: import('./sandbox-types').SandboxTabState
  /** Cumulative token usage for this tab's session */
  tokenUsage: TokenUsageSnapshot | null
  /** Whether large-context notification has been shown for this session */
  contextNotificationShown: boolean
  /** Session ID of the parent session this tab was forked from */
  parentSessionId?: string
  /** PR number when this tab is a PR review (opened via /pr or openPrReview) */
  prNumber?: number
  /** Agent name when this tab is an agent tab */
  agentName?: string
  /** Parent tab ID for agent tab grouping */
  parentTabId?: string
  /** Whether this tab was restored from IndexedDB persistence */
  isRestored?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolInput?: string
  toolStatus?: 'running' | 'completed' | 'error'
  timestamp: number
  /** Internal: streaming text chunk accumulator. Joined into `content` on flush. */
  _textChunks?: string[]
  /** Companion narrator message (Haiku-powered idle-time commentary) */
  isCompanion?: boolean
}

export interface RunResult {
  totalCostUsd: number
  durationMs: number
  numTurns: number
  usage: UsageData
  sessionId: string
}

export type ExportFormat = 'markdown' | 'json'

export interface ExportOptions {
  format: ExportFormat
  includeUserMessages: boolean
  includeAssistantMessages: boolean
  includeToolCalls: boolean
  includeMetadata: boolean
}

export interface SessionExportData {
  title: string
  exportedAt: string
  sessionId: string | null
  projectPath: string
  model: string | null
  messages: Message[]
  lastResult: RunResult | null
}

export interface SessionExportResult {
  ok: boolean
  path: string | null
  error?: string
}

export interface ShortcutBinding {
  id: string
  label: string
  category: 'navigation' | 'view' | 'actions'
  defaultKeys: string
  currentKeys: string
}

export type ShortcutMap = Record<string, string>

// ─── Canonical Events (normalized from raw stream) ───

export type NormalizedEvent =
  | { type: 'session_init'; sessionId: string; tools: string[]; model: string; mcpServers: Array<{ name: string; status: string }>; skills: string[]; version: string; isWarmup?: boolean }
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_call'; toolName: string; toolId: string; index: number }
  | { type: 'tool_call_update'; toolId: string; partialInput: string }
  | { type: 'tool_call_complete'; index: number }
  | { type: 'task_update'; message: AssistantMessagePayload }
  | { type: 'task_complete'; result: string; costUsd: number; durationMs: number; numTurns: number; usage: UsageData; sessionId: string; permissionDenials?: Array<{ toolName: string; toolUseId: string }> }
  | { type: 'error'; message: string; isError: boolean; sessionId?: string }
  | { type: 'session_dead'; exitCode: number | null; signal: string | null; stderrTail: string[] }
  | { type: 'rate_limit'; status: string; resetsAt: number; rateLimitType: string }
  | { type: 'usage'; usage: UsageData }
  | { type: 'permission_request'; questionId: string; toolName: string; toolDescription?: string; toolInput?: Record<string, unknown>; options: Array<{ id: string; label: string; kind?: string }> }
  | { type: 'sandbox_worktree_created'; worktreeInfo: import('./sandbox-types').WorktreeInfo }
  | { type: 'sandbox_diff_ready'; runId: string; diff: import('./sandbox-types').DiffSummary }
  | { type: 'sandbox_merge_done'; runId: string; result: import('./sandbox-types').MergeResult }
  | { type: 'sandbox_dirty_warning'; runId: string; dirty: import('./sandbox-types').DirtyState }
  | { type: 'token_usage'; inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: 'context_management'; data: unknown }
  | { type: 'companion_message'; content: string }

// ─── Token Usage Tracking ───

export interface TokenUsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  lastUpdated: number
}

// ─── Effort Levels ───

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

// ─── Run Options ───

export interface RunOptions {
  prompt: string
  projectPath: string
  sessionId?: string
  allowedTools?: string[]
  maxTurns?: number
  maxBudgetUsd?: number
  systemPrompt?: string
  model?: string
  /** Path to CLUI-scoped settings file with hook config (passed via --settings) */
  hookSettingsPath?: string
  /** Extra directories to add via --add-dir (session-preserving) */
  addDirs?: string[]
  /** Runtime environment: native (default) or wsl */
  runtime?: 'native' | 'wsl'
  /** WSL distribution name (required when runtime is 'wsl') */
  wslDistro?: string
  /** Sandbox mode options */
  sandbox?: import('./sandbox-types').SandboxOptions
  /** CLI effort level (controls reasoning depth) */
  effort?: EffortLevel
  /** Fork an existing session into a new independent branch */
  forkSession?: boolean
  /** Session ID to fork from (used with forkSession) */
  forkFromSessionId?: string
  /** PR number or URL for --from-pr flag */
  fromPr?: string
  /** Pre-configured agent name (passed as --agent <name>) */
  agent?: string
  /** Custom inline agent definitions (passed as --agents '<json>') */
  agentConfig?: Record<string, AgentConfig>
}

// ─── Control Plane Types ───

export interface TabRegistryEntry {
  tabId: string
  claudeSessionId: string | null
  status: TabStatus
  activeRequestId: string | null
  runPid: number | null
  createdAt: number
  lastActivityAt: number
  promptCount: number
  runtime: 'native' | 'wsl'
  wslDistro: string | null
}

export interface HealthReport {
  tabs: Array<{
    tabId: string
    status: TabStatus
    activeRequestId: string | null
    claudeSessionId: string | null
    alive: boolean
  }>
  queueDepth: number
}

export interface ContextHealthResult {
  available: boolean
  memoryCount: number
  sessionCount: number
  degradedReason: string | null
}

export interface EnrichedError {
  message: string
  stderrTail: string[]
  stdoutTail?: string[]
  exitCode: number | null
  elapsedMs: number
  toolCallCount: number
  sawPermissionRequest?: boolean
  permissionDenials?: Array<{ tool_name: string; tool_use_id: string }>
}

// ─── Session History ───

export interface SessionMeta {
  sessionId: string
  slug: string | null
  firstMessage: string | null
  lastTimestamp: string
  size: number
  pinned: boolean
}

export interface SessionLoadMessage {
  role: string
  content: string
  toolName?: string
  timestamp: number
}

// ─── Cost Tracking ───

export interface CostRecord {
  timestamp: number
  sessionId: string
  model: string | null
  projectPath: string
  costUsd: number
  durationMs: number
  numTurns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface CostSummary {
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalDurationMs: number
  runCount: number
  byModel: Record<string, { costUsd: number; runs: number }>
  byProject: Record<string, { costUsd: number; runs: number }>
  byDay: Array<{ date: string; costUsd: number; runs: number }>
}

// ─── Session Digest Types ───

export interface SessionDigest {
  id: string
  tabId: string
  tabTitle: string
  projectPath: string
  digest: string
  filesModified: string[]
  generatedAt: number
  costUsd: number
}

export interface SessionDigestSettings {
  enabled: boolean
}

export interface SessionDigestStats {
  totalDigests: number
  totalCostUsd: number
  monthlyDigests: number
  monthlyCostUsd: number
}

// ─── Marketplace / Plugin Types ───

export type PluginStatus = 'not_installed' | 'checking' | 'installing' | 'installed' | 'failed'

export interface CatalogPlugin {
  id: string              // unique: `${repo}/${skillPath}` e.g. 'anthropics/skills/skills/xlsx'
  name: string            // from SKILL.md or plugin.json
  description: string     // from SKILL.md or plugin.json
  version: string         // from plugin.json or '0.0.0'
  author: string          // from plugin.json or marketplace entry
  marketplace: string     // marketplace name from marketplace.json
  repo: string            // 'anthropics/skills' (empty for locally-installed orphans)
  sourcePath: string      // path within repo, e.g. 'skills/xlsx'
  installName: string     // individual skill name for SKILL.md skills, bundle name for CLI plugins
  category: string        // 'Agent Skills' | 'Knowledge Work' | 'Financial Services' | 'Official Plugins' | etc.
  tags: string[]          // Semantic use-case tags derived from name/description (e.g. 'Design', 'Finance')
  isSkillMd: boolean      // true = individual SKILL.md (direct install), false = CLI plugin (bundle install)
}

export interface InstalledPluginEntry {
  name: string            // plugin name (e.g. 'code-review')
  key: string             // original key from installed_plugins.json or directory name
  marketplace: string     // extracted from 'name@marketplace' format, or '' for skills
  type: 'plugin' | 'skill'
}

// ─── Git Context ───

export interface GitFileStatus {
  status: 'M' | 'A' | 'D' | 'R' | '?'
  path: string
}

export interface GitStatus {
  branch: string | null
  isRepo: boolean
  files: GitFileStatus[]
}

// ─── WSL Types ───

export interface WslStatus {
  available: boolean
  distros: Array<{
    name: string
    isDefault: boolean
    state: 'Running' | 'Stopped' | 'Installing'
    version: 1 | 2
    hasClaude: boolean | null
  }>
}

// ─── Terminal Types ───

export interface TerminalTab {
  id: string
  title: string
  shell: string
  cwd: string
  status: 'active' | 'exited'
  exitCode: number | null
  bellCount?: number
}

export interface TerminalCreateOptions {
  shell?: string
  cwd?: string
}

// ─── Inline Shell ───

export interface ShellExecRequest {
  tabId: string
  command: string
  cwd: string
}

export interface ShellOutput {
  stdout: string
  stderr: string
  exitCode: number
  /** True if output was truncated at the 50 KB cap */
  truncated: boolean
  /** The command that was executed */
  command: string
  /** Duration in milliseconds */
  durationMs: number
}

// ─── IPC Channel Names ───

export const IPC = {
  // Request-response (renderer → main)
  START: 'clui:start',
  CREATE_TAB: 'clui:create-tab',
  PROMPT: 'clui:prompt',
  CANCEL: 'clui:cancel',
  STOP_TAB: 'clui:stop-tab',
  RETRY: 'clui:retry',
  STATUS: 'clui:status',
  TAB_HEALTH: 'clui:tab-health',
  CLOSE_TAB: 'clui:close-tab',
  SELECT_DIRECTORY: 'clui:select-directory',
  OPEN_EXTERNAL: 'clui:open-external',
  OPEN_IN_TERMINAL: 'clui:open-in-terminal',
  ATTACH_FILES: 'clui:attach-files',
  AUTO_ATTACH_GET: 'clui:auto-attach-get',
  AUTO_ATTACH_SET: 'clui:auto-attach-set',
  AUTO_ATTACH_ADD: 'clui:auto-attach-add',
  AUTO_ATTACH_REMOVE: 'clui:auto-attach-remove',
  TAKE_SCREENSHOT: 'clui:take-screenshot',
  TRANSCRIBE_AUDIO: 'clui:transcribe-audio',
  PASTE_IMAGE: 'clui:paste-image',
  GET_DIAGNOSTICS: 'clui:get-diagnostics',
  RESPOND_PERMISSION: 'clui:respond-permission',
  INIT_SESSION: 'clui:init-session',
  RESET_TAB_SESSION: 'clui:reset-tab-session',
  ANIMATE_HEIGHT: 'clui:animate-height',
  LIST_SESSIONS: 'clui:list-sessions',
  LOAD_SESSION: 'clui:load-session',
  EXPORT_SESSION: 'clui:export-session',
  AGENT_MEMORY_GET: 'clui:agent-memory-get',
  AGENT_MEMORY_FOCUS: 'clui:agent-memory-focus',
  AGENT_MEMORY_CLAIM: 'clui:agent-memory-claim',
  AGENT_MEMORY_DONE: 'clui:agent-memory-done',
  AGENT_MEMORY_RELEASE: 'clui:agent-memory-release',
  PIN_SESSION: 'clui:pin-session',
  UNPIN_SESSION: 'clui:unpin-session',
  FORK_SESSION: 'clui:fork-session',
  OPEN_PR_REVIEW: 'clui:open-pr-review',
  CREATE_AGENT_TAB: 'clui:create-agent-tab',
  LIST_AGENTS: 'clui:list-agents',
  SHELL_EXEC: 'clui:shell-exec',
  COMPANION_SETTING_GET: 'clui:companion-setting-get',
  COMPANION_SETTING_SET: 'clui:companion-setting-set',

  // One-way events (main → renderer)
  TEXT_CHUNK: 'clui:text-chunk',
  TOOL_CALL: 'clui:tool-call',
  TOOL_CALL_UPDATE: 'clui:tool-call-update',
  TOOL_CALL_COMPLETE: 'clui:tool-call-complete',
  TASK_UPDATE: 'clui:task-update',
  TASK_COMPLETE: 'clui:task-complete',
  SESSION_DEAD: 'clui:session-dead',
  SESSION_INIT: 'clui:session-init',
  ERROR: 'clui:error',
  RATE_LIMIT: 'clui:rate-limit',

  // Window management
  RESIZE_HEIGHT: 'clui:resize-height',
  SET_WINDOW_WIDTH: 'clui:set-window-width',
  HIDE_WINDOW: 'clui:hide-window',
  WINDOW_SHOWN: 'clui:window-shown',
  SET_IGNORE_MOUSE_EVENTS: 'clui:set-ignore-mouse-events',
  IS_VISIBLE: 'clui:is-visible',

  // Skill provisioning (main → renderer)
  SKILL_STATUS: 'clui:skill-status',

  // Theme
  GET_THEME: 'clui:get-theme',
  THEME_CHANGED: 'clui:theme-changed',

  // Marketplace
  MARKETPLACE_FETCH: 'clui:marketplace-fetch',
  MARKETPLACE_INSTALLED: 'clui:marketplace-installed',
  MARKETPLACE_INSTALL: 'clui:marketplace-install',
  MARKETPLACE_UNINSTALL: 'clui:marketplace-uninstall',

  // Permission mode
  SET_PERMISSION_MODE: 'clui:set-permission-mode',

  // Permission management (settings.json)
  PERMISSIONS_GET: 'clui:permissions-get',
  PERMISSIONS_ADD: 'clui:permissions-add',
  PERMISSIONS_REMOVE: 'clui:permissions-remove',
  PERMISSIONS_APPLY_PRESET: 'clui:permissions-apply-preset',
  PERMISSIONS_NEEDS_SETUP: 'clui:permissions-needs-setup',
  PERMISSIONS_DISMISS_SETUP: 'clui:permissions-dismiss-setup',

  // Cost tracking
  COST_RECORD: 'clui:cost-record',
  COST_SUMMARY: 'clui:cost-summary',
  COST_HISTORY: 'clui:cost-history',

  // Budget controls
  BUDGET_GET_CONFIG: 'clui:budget-get-config',
  BUDGET_SET_CONFIG: 'clui:budget-set-config',
  BUDGET_GET_STATUS: 'clui:budget-get-status',
  BUDGET_ALERT: 'clui:budget-alert',

  // Response cache
  CACHE_LOOKUP: 'clui:cache-lookup',
  CACHE_STORE: 'clui:cache-store',
  CACHE_CLEAR: 'clui:cache-clear',
  CACHE_STATS: 'clui:cache-stats',

  // Git context
  GIT_STATUS: 'clui:git-status',
  GIT_DIFF: 'clui:git-diff',

  // Sandbox
  SANDBOX_CHECK_DIRTY: 'clui:sandbox-check-dirty',
  SANDBOX_GET_DIFF: 'clui:sandbox-get-diff',
  SANDBOX_MERGE: 'clui:sandbox-merge',
  SANDBOX_REVERT: 'clui:sandbox-revert',
  SANDBOX_AUTO_STASH: 'clui:sandbox-auto-stash',
  SANDBOX_LIST_FILES: 'clui:sandbox-list-files',
  SANDBOX_LIST_STASHES: 'clui:sandbox-list-stashes',
  SANDBOX_GET_STASH_DIFF: 'clui:sandbox-get-stash-diff',
  SANDBOX_WORKTREE_STATUS: 'clui:sandbox-worktree-status',

  // Notifications
  NOTIFY_DESKTOP: 'clui:notify-desktop',
  GET_NOTIFICATION_PREFS: 'clui:get-notification-prefs',
  SET_NOTIFICATION_PREFS: 'clui:set-notification-prefs',

  // Event broadcast (main → renderer)
  NORMALIZED_EVENT: 'clui:normalized-event',
  NORMALIZED_EVENT_BATCH: 'clui:normalized-event-batch',
  TAB_STATUS_CHANGE: 'clui:tab-status-change',
  ENRICHED_ERROR: 'clui:enriched-error',

  // Whisper provisioning
  WHISPER_STATUS: 'clui:whisper-status',

  // Terminal
  TERMINAL_CREATE: 'clui:terminal-create',
  TERMINAL_WRITE: 'clui:terminal-write',
  TERMINAL_RESIZE: 'clui:terminal-resize',
  TERMINAL_CLOSE: 'clui:terminal-close',
  TERMINAL_DATA: 'clui:terminal-data',
  TERMINAL_EXIT: 'clui:terminal-exit',
  TERMINAL_AVAILABLE: 'clui:terminal-available',

  // Error logging
  LOG_RENDERER_ERROR: 'clui:log-renderer-error',

  // Shortcut hint
  SHORTCUT_REGISTERED: 'clui:shortcut-registered',

  // File peek
  FILE_READ: 'clui:file-read',
  FILE_REVEAL: 'clui:file-reveal',
  FILE_OPEN_EXTERNAL: 'clui:file-open-external',

  // WSL runtime
  WSL_STATUS: 'clui:wsl-status',
  WSL_CHECK_CLAUDE: 'clui:wsl-check-claude',
  WSL_BROWSE: 'clui:wsl-browse',

  // Context database
  CONTEXT_SEARCH_MEMORIES: 'clui:context-search-memories',
  CONTEXT_GET_SESSION_HISTORY: 'clui:context-get-session-history',
  CONTEXT_GET_SESSION_DETAIL: 'clui:context-get-session-detail',
  CONTEXT_GET_PROJECT_STATS: 'clui:context-get-project-stats',
  CONTEXT_PIN_MEMORY: 'clui:context-pin-memory',
  CONTEXT_UNPIN_MEMORY: 'clui:context-unpin-memory',
  CONTEXT_DELETE_MEMORY: 'clui:context-delete-memory',
  CONTEXT_GET_FILES_TOUCHED: 'clui:context-get-files-touched',
  CONTEXT_GET_MEMORY_PACKET_PREVIEW: 'clui:context-get-memory-packet-preview',
  CONTEXT_MEMORY_CREATED: 'clui:context-memory-created',
  CONTEXT_SESSION_RECORDED: 'clui:context-session-recorded',
  CONTEXT_HEALTH: 'clui:context-health',

  // Session digest
  SESSION_DIGEST_GENERATE: 'clui:session-digest-generate',
  SESSION_DIGEST_GET: 'clui:session-digest-get',
  SESSION_DIGEST_SETTING: 'clui:session-digest-setting',
  SESSION_DIGEST_STATS: 'clui:session-digest-stats',

  // Legacy (kept for backward compat during migration)
  STREAM_EVENT: 'clui:stream-event',
  RUN_COMPLETE: 'clui:run-complete',
  RUN_ERROR: 'clui:run-error',
} as const
