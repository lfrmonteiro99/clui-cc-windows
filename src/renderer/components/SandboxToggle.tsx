import { motion } from 'framer-motion'
import { GitBranch } from '@phosphor-icons/react'
import { useSandboxStore } from '../stores/sandboxStore'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

export function SandboxToggle() {
  const colors = useColors()
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const enabled = useSandboxStore((s) => activeTabId ? (s.tabStates.get(activeTabId)?.enabled ?? false) : false)
  const setEnabled = useSandboxStore((s) => s.setEnabled)

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={() => setEnabled(activeTabId, !enabled)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
      style={{
        background: enabled ? 'rgba(34,197,94,0.12)' : colors.surfaceSecondary,
        border: `1px solid ${enabled ? 'rgba(34,197,94,0.25)' : colors.containerBorder}`,
        color: enabled ? colors.statusComplete : colors.textSecondary,
      }}
      aria-label={enabled ? 'Disable sandbox mode' : 'Enable sandbox mode'}
      aria-pressed={enabled}
    >
      <GitBranch size={14} weight={enabled ? 'fill' : 'regular'} />
      {enabled ? 'Sandbox ON' : 'Sandbox OFF'}
    </motion.button>
  )
}
