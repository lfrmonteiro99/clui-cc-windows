import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldWarning, Terminal, ArrowSquareOut, ShieldCheck } from '@phosphor-icons/react'
import { useColors } from '../theme'

interface Props {
  tools: Array<{ toolName: string; toolUseId: string }>
  sessionId: string | null
  projectPath: string
  onDismiss: () => void
}

/** Convert a tool name from a permission denial to its settings.json permission pattern */
function toolToPermissionPattern(toolName: string): string {
  if (toolName === 'Bash') return 'Bash(*)'
  return toolName
}

export function PermissionDeniedCard({ tools, sessionId, projectPath, onDismiss }: Props) {
  const colors = useColors()
  const [allowedTools, setAllowedTools] = useState<Set<string>>(new Set())
  const [allowingAll, setAllowingAll] = useState(false)

  const handleOpenInCli = () => {
    if (sessionId) {
      window.clui.openInTerminal(sessionId, projectPath)
    }
    onDismiss()
  }

  const toolNames = [...new Set(tools.map((t) => t.toolName))]

  const handleAllowTool = async (toolName: string) => {
    const pattern = toolToPermissionPattern(toolName)
    try {
      await window.clui.addPermission(pattern)
      setAllowedTools((prev) => new Set([...prev, toolName]))
    } catch {}
  }

  const handleAllowAll = async () => {
    setAllowingAll(true)
    try {
      for (const name of toolNames) {
        const pattern = toolToPermissionPattern(name)
        await window.clui.addPermission(pattern)
      }
      setAllowedTools(new Set(toolNames))
    } catch {}
    setAllowingAll(false)
  }

  const allAllowed = toolNames.every((n) => allowedTools.has(n))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="mx-4 mb-2"
    >
      <div
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.permissionDeniedBorder}`,
          borderRadius: 14,
          boxShadow: `0 2px 12px ${colors.statusErrorBg}`,
        }}
        className="overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            background: colors.statusErrorBg,
            borderBottom: `1px solid ${colors.permissionDeniedHeaderBorder}`,
          }}
        >
          <ShieldWarning size={14} style={{ color: colors.statusError }} />
          <span className="text-[12px] font-semibold" style={{ color: colors.statusError }}>
            Tools Denied by Permission Settings
          </span>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          <p className="text-[11px] leading-[1.5] mb-2" style={{ color: colors.textSecondary }}>
            {allAllowed
              ? 'Permissions saved. Retry your prompt to use these tools.'
              : 'These tools were blocked. Allow them permanently or open in CLI.'}
          </p>

          {/* Tool list with per-tool Allow buttons */}
          {tools.length > 0 && (
            <div className="flex flex-col gap-1 mb-2">
              {toolNames.map((name) => {
                const isAllowed = allowedTools.has(name)
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between px-2 py-1 rounded-md"
                    style={{
                      background: isAllowed ? colors.permissionAllowBg : colors.surfacePrimary,
                      border: `1px solid ${isAllowed ? colors.permissionAllowBorder : colors.surfaceSecondary}`,
                    }}
                  >
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono" style={{ color: isAllowed ? colors.statusComplete : colors.textTertiary }}>
                      {isAllowed ? <ShieldCheck size={10} /> : <Terminal size={10} />}
                      {name}
                      {isAllowed && <span className="text-[9px] opacity-70 ml-1">allowed</span>}
                    </span>
                    {!isAllowed && (
                      <button
                        onClick={() => handleAllowTool(name)}
                        className="text-[9px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors"
                        style={{
                          background: colors.permissionAllowBg,
                          color: colors.statusComplete,
                          border: `1px solid ${colors.permissionAllowBorder}`,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = colors.permissionAllowHoverBg }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = colors.permissionAllowBg }}
                      >
                        Allow Always
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-1.5 flex-wrap">
            {!allAllowed && toolNames.length > 1 && (
              <button
                onClick={handleAllowAll}
                disabled={allowingAll}
                className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
                style={{
                  background: colors.permissionAllowBg,
                  color: colors.statusComplete,
                  border: `1px solid ${colors.permissionAllowBorder}`,
                }}
                onMouseEnter={(e) => { if (!allowingAll) e.currentTarget.style.background = colors.permissionAllowHoverBg }}
                onMouseLeave={(e) => { if (!allowingAll) e.currentTarget.style.background = colors.permissionAllowBg }}
              >
                <ShieldCheck size={12} />
                Allow All
              </button>
            )}
            {sessionId && (
              <button
                onClick={handleOpenInCli}
                className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer flex items-center gap-1.5"
                style={{
                  background: colors.accentLight,
                  color: colors.accent,
                  border: `1px solid ${colors.accentBorderMedium}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.accentSoft }}
                onMouseLeave={(e) => { e.currentTarget.style.background = colors.accentLight }}
              >
                <ArrowSquareOut size={12} />
                Open in CLI
              </button>
            )}
            <button
              onClick={onDismiss}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer"
              style={{
                background: colors.surfaceHover,
                color: colors.textTertiary,
                border: `1px solid ${colors.surfaceSecondary}`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceActive }}
              onMouseLeave={(e) => { e.currentTarget.style.background = colors.surfaceHover }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
