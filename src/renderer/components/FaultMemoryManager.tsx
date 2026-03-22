import React, { useMemo, useState } from 'react'
import { Brain, Trash, X } from '@phosphor-icons/react'
import { useColors } from '../theme'
import { useFaultMemoryStore } from '../stores/faultMemoryStore'
import type { FactCategory } from '../../shared/fault-memory-types'

const CATEGORY_LABELS: Record<FactCategory, string> = {
  tooling: 'Tooling',
  style: 'Style',
  convention: 'Convention',
  preference: 'Preference',
  other: 'Other',
}

interface FaultMemoryManagerProps {
  project: string
}

export function FaultMemoryManager({ project }: FaultMemoryManagerProps) {
  const colors = useColors()
  const facts = useFaultMemoryStore((s) => s.facts)
  const removeFact = useFaultMemoryStore((s) => s.removeFact)
  const clearProjectFacts = useFaultMemoryStore((s) => s.clearProjectFacts)
  const closeManager = useFaultMemoryStore((s) => s.closeManager)

  const [search, setSearch] = useState('')

  const projectFacts = useMemo(() => {
    const pf = facts.filter((f) => f.project === project)
    const query = search.trim().toLowerCase()
    if (!query) return pf
    return pf.filter(
      (f) =>
        f.pattern.toLowerCase().includes(query) ||
        f.correction.toLowerCase().includes(query) ||
        f.context.toLowerCase().includes(query),
    )
  }, [facts, project, search])

  const formatFact = (pattern: string, correction: string): string => {
    if (pattern && correction) return `Use ${correction}, not ${pattern}`
    if (correction) return correction
    if (pattern) return `Avoid ${pattern}`
    return '(empty)'
  }

  return (
    <div
      data-clui-ui
      style={{
        height: 470,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 18px 10px',
          borderBottom: `1px solid ${colors.containerBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={20} style={{ color: colors.accent }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
              Fault Memory
            </div>
            <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
              Learned corrections for this project ({projectFacts.length})
            </div>
          </div>
        </div>
        <button
          onClick={closeManager}
          aria-label="Close fault memory"
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ color: colors.textTertiary }}
          title="Close fault memory"
        >
          <X size={15} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: 16, borderBottom: `1px solid ${colors.containerBorder}` }}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search corrections..."
          className="w-full rounded-xl px-3 py-2 text-[12px]"
          style={{
            background: colors.surfacePrimary,
            color: colors.textPrimary,
            border: `1px solid ${colors.containerBorder}`,
          }}
        />
      </div>

      {/* Fact list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {projectFacts.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-6 text-center"
            style={{
              background: colors.surfacePrimary,
              color: colors.textTertiary,
              border: `1px solid ${colors.containerBorder}`,
            }}
          >
            No corrections stored yet. When you correct Claude, preferences are saved here automatically.
          </div>
        ) : (
          <div className="grid gap-3" role="listbox" aria-label="Stored corrections">
            {projectFacts.map((fact) => (
              <div
                key={fact.id}
                className="rounded-2xl p-3"
                style={{
                  background: colors.surfacePrimary,
                  border: `1px solid ${colors.containerBorder}`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className="text-[12px] font-medium"
                      style={{ color: colors.textPrimary }}
                    >
                      {formatFact(fact.pattern, fact.correction)}
                    </div>
                    <div
                      className="text-[10px] mt-1"
                      style={{ color: colors.accent }}
                    >
                      {CATEGORY_LABELS[fact.category]}
                      {fact.usageCount > 0 && ` \u00b7 used ${fact.usageCount}x`}
                    </div>
                    {fact.context && (
                      <div
                        className="text-[11px] mt-2 whitespace-pre-wrap"
                        style={{ color: colors.textSecondary }}
                      >
                        {fact.context.length > 120
                          ? `${fact.context.slice(0, 117)}...`
                          : fact.context}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeFact(fact.id)}
                    aria-label={`Delete correction: ${formatFact(fact.pattern, fact.correction)}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      color: colors.statusError,
                      background: colors.surfaceSecondary,
                    }}
                    title="Delete correction"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: clear all */}
      {projectFacts.length > 0 && !search && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${colors.containerBorder}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={() => clearProjectFacts(project)}
            className="rounded-xl px-3 py-2 text-[11px]"
            style={{
              color: colors.statusError,
              background: colors.surfaceSecondary,
            }}
          >
            Clear All ({projectFacts.length})
          </button>
        </div>
      )}
    </div>
  )
}
