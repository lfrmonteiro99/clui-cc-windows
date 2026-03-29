import React from 'react'
import { motion } from 'framer-motion'
import { ShieldWarning, Terminal, PencilSimple, Globe, Wrench, Clock } from '@phosphor-icons/react'
import { usePermissionStore } from '../stores/permissionStore'
import { useColors } from '../theme'
import type { PermissionRequest } from '../../shared/types'

interface Props {
  tabId: string
  permission: PermissionRequest
  queueLength?: number
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Bash: <Terminal size={14} />,
  Edit: <PencilSimple size={14} />,
  Write: <PencilSimple size={14} />,
  WebSearch: <Globe size={14} />,
  WebFetch: <Globe size={14} />,
}

function getToolIcon(name: string) {
  return TOOL_ICONS[name] || <Wrench size={14} />
}

const SENSITIVE_FIELD_RE = /token|password|secret|key|auth|credential|api.?key/i

function formatInput(input?: Record<string, unknown>): string | null {
  if (!input) return null
  const entries = Object.entries(input)
  if (entries.length === 0) return null

  const parts: string[] = []
  for (const [key, value] of entries) {
    // Defense-in-depth: mask sensitive fields (backend already masks too)
    if (SENSITIVE_FIELD_RE.test(key)) {
      parts.push(`${key}: ***`)
      continue
    }
    const val = typeof value === 'string' ? value : JSON.stringify(value)
    const truncated = val.length > 120 ? val.substring(0, 117) + '...' : val
    parts.push(`${key}: ${truncated}`)
  }
  return parts.join('\n')
}

const BATCH_APPROVE_DURATION_MS = 30 * 60 * 1000 // 30 minutes

export function PermissionCard({ tabId, permission, queueLength = 1 }: Props) {
  const respondPermission = usePermissionStore((s) => s.respondPermission)
  const enableBatchApprove = usePermissionStore((s) => s.enableBatchApprove)
  const addTrustedTool = usePermissionStore((s) => s.addTrustedTool)
  const isToolTrusted = usePermissionStore((s) => s.isToolTrusted)
  const colors = useColors()
  const [responded, setResponded] = React.useState(false)
  const [alwaysAllow, setAlwaysAllow] = React.useState(false)

  // Sync checkbox with trusted tools on mount / permission change
  React.useEffect(() => {
    setAlwaysAllow(isToolTrusted(permission.toolTitle))
  }, [permission.toolTitle, isToolTrusted])

  // Reset responded flag when the displayed permission changes (queue advancing)
  React.useEffect(() => {
    setResponded(false)
  }, [permission.questionId])

  const findAllowOptionId = (): string | null => {
    const allowOpt = permission.options.find(
      (o) => o.kind === 'allow' || o.label.toLowerCase().includes('allow') || o.label.toLowerCase().includes('yes')
    )
    return allowOpt?.optionId ?? null
  }

  const handleOption = (optionId: string) => {
    if (responded) return // Prevent double-send
    setResponded(true)
    respondPermission(tabId, permission.questionId, optionId)
  }

  const handleAlwaysAllowToggle = () => {
    if (alwaysAllow) return // Already trusted, don't un-trust from card (use settings)
    setAlwaysAllow(true)
    addTrustedTool(permission.toolTitle)
    // Auto-approve this permission
    const allowId = findAllowOptionId()
    if (allowId) {
      handleOption(allowId)
    }
  }

  const handleBatchApprove = () => {
    if (responded) return
    enableBatchApprove(BATCH_APPROVE_DURATION_MS)
    // Approve this current permission
    const allowId = findAllowOptionId()
    if (allowId) {
      handleOption(allowId)
    }
  }

  const inputPreview = formatInput(permission.toolInput)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="mx-4 mt-2 mb-2"
    >
      <div
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.permissionBorder}`,
          borderRadius: 12,
          boxShadow: colors.permissionShadow,
        }}
        className="overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5"
          style={{
            background: colors.permissionHeaderBg,
            borderBottom: `1px solid ${colors.permissionHeaderBorder}`,
          }}
        >
          <ShieldWarning size={12} style={{ color: colors.statusPermission }} />
          <span className="text-[11px] font-semibold" style={{ color: colors.statusPermission }}>
            Permission Required
          </span>
        </div>

        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span style={{ color: colors.textTertiary }}>{getToolIcon(permission.toolTitle)}</span>
            <span className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
              {permission.toolTitle}
            </span>
          </div>

          {/* Always allow checkbox */}
          <label
            data-testid="always-allow-checkbox"
            className="flex items-center gap-1.5 mb-1.5 cursor-pointer select-none"
            style={{ color: colors.textTertiary }}
          >
            <input
              type="checkbox"
              checked={alwaysAllow}
              onChange={handleAlwaysAllowToggle}
              disabled={responded || alwaysAllow}
              className="w-3 h-3 rounded cursor-pointer accent-current"
              style={{ accentColor: colors.accent }}
            />
            <span className="text-[10px]">
              Always allow {permission.toolTitle}
            </span>
          </label>

          {permission.toolDescription && (
            <p className="text-[11px] leading-[1.4] mb-1.5" style={{ color: colors.textSecondary }}>
              {permission.toolDescription}
            </p>
          )}

          {inputPreview && (
            <div
              data-testid="permission-input-wrapper"
              className="relative mb-2"
            >
              <pre
                data-testid="permission-input-preview"
                className="text-[10px] leading-[1.4] px-2 py-1.5 rounded-md whitespace-pre-wrap break-all"
                style={{
                  background: colors.codeBg,
                  color: colors.textSecondary,
                  maxHeight: '120px',
                  overflowY: 'auto',
                  overflowX: 'auto',
                }}
              >
                {inputPreview}
              </pre>
              {/* Gradient fade at bottom when content may overflow */}
              <div
                className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none rounded-b-md"
                style={{
                  background: `linear-gradient(to bottom, transparent, ${colors.codeBg})`,
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {permission.options.map((opt) => {
              const isAllow = opt.kind === 'allow' || opt.label.toLowerCase().includes('allow')
                || opt.label.toLowerCase().includes('yes')
              const isDeny = opt.kind === 'deny' || opt.label.toLowerCase().includes('deny')
                || opt.label.toLowerCase().includes('no') || opt.label.toLowerCase().includes('reject')

              let bg: string
              let hoverBg: string
              let textColor: string
              let borderColor: string

              if (isAllow) {
                bg = colors.permissionAllowBg
                hoverBg = colors.permissionAllowHoverBg
                textColor = colors.statusComplete
                borderColor = colors.permissionAllowBorder
              } else if (isDeny) {
                bg = colors.permissionDenyBg
                hoverBg = colors.permissionDenyHoverBg
                textColor = colors.statusError
                borderColor = colors.permissionDenyBorder
              } else {
                bg = colors.accentLight
                hoverBg = colors.accentSoft
                textColor = colors.accent
                borderColor = colors.accentSoft
              }

              return (
                <button
                  key={opt.optionId}
                  onClick={() => handleOption(opt.optionId)}
                  disabled={responded}
                  className="clui-focus-ring text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: bg,
                    color: textColor,
                    border: `1px solid ${borderColor}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!responded) e.currentTarget.style.background = hoverBg
                  }}
                  onMouseLeave={(e) => {
                    if (!responded) e.currentTarget.style.background = bg
                  }}
                >
                  {opt.label}
                </button>
              )
            })}

            {/* Batch approve button — only when multiple permissions queued */}
            {queueLength > 1 && (
              <button
                data-testid="batch-approve-button"
                onClick={handleBatchApprove}
                disabled={responded}
                className="clui-focus-ring text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                style={{
                  background: colors.accentLight,
                  color: colors.accent,
                  border: `1px solid ${colors.accentSoft}`,
                }}
                onMouseEnter={(e) => {
                  if (!responded) e.currentTarget.style.background = colors.accentSoft
                }}
                onMouseLeave={(e) => {
                  if (!responded) e.currentTarget.style.background = colors.accentLight
                }}
              >
                <Clock size={12} />
                Allow all for 30 min
              </button>
            )}

            {queueLength > 1 && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{
                  background: colors.accentLight,
                  color: colors.accent,
                }}
              >
                +{queueLength - 1} more
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
