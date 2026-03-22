/**
 * PruneIndicator — badge showing recoverable tokens from context pruning.
 * Appears near the ContextBar when pruning opportunities exist.
 */

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FunnelSimple, ArrowsIn, ArrowsOut, CaretDown, CaretRight } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { PruneResult } from '../../shared/context-pruner'

interface Props {
  result: PruneResult
  onCollapseAll: () => void
  onExpandAll: () => void
  hasCollapsed: boolean
}

export const PruneIndicator = React.memo(function PruneIndicator({
  result,
  onCollapseAll,
  onExpandAll,
  hasCollapsed,
}: Props) {
  const [showDetails, setShowDetails] = useState(false)
  const colors = useColors()

  if (result.actions.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
          style={{
            background: colors.surfaceTertiary,
            color: colors.textMuted,
          }}
        >
          <FunnelSimple size={10} />
          ~{result.savedTokens.toLocaleString()} tokens recoverable
          {showDetails ? <CaretDown size={8} /> : <CaretRight size={8} />}
        </button>

        <button
          onClick={hasCollapsed ? onExpandAll : onCollapseAll}
          className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{
            background: colors.accentPrimary,
            color: colors.textOnAccent,
          }}
        >
          {hasCollapsed ? (
            <><ArrowsOut size={10} /> Expand all</>
          ) : (
            <><ArrowsIn size={10} /> Collapse all</>
          )}
        </button>
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            <div className="pl-2 space-y-0.5">
              {result.actions.map((action, i) => (
                <div key={i} className="text-[10px]" style={{ color: colors.textMuted }}>
                  • {action.reason} ({action.messageIds.length} msg{action.messageIds.length !== 1 ? 's' : ''})
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
