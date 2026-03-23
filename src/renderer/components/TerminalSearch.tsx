import React, { useRef, useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MagnifyingGlass, CaretUp, CaretDown, X, TextAa, BracketsCurly } from '@phosphor-icons/react'
import { useColors } from '../theme'

interface SearchOptions {
  caseSensitive: boolean
  regex: boolean
}

interface Props {
  onSearch: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
  onNext: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
  onPrev: (term: string, options: SearchOptions) => { resultIndex: number; resultCount: number }
  onClose: () => void
  resultIndex: number
  resultCount: number
}

export function TerminalSearch({ onSearch, onNext, onPrev, onClose, resultIndex, resultCount }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const colors = useColors()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => clearTimeout(debounceRef.current)
  }, [])

  const options: SearchOptions = { caseSensitive, regex }

  const triggerSearch = useCallback((val: string, opts: SearchOptions) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (val.trim()) {
        onSearch(val, opts)
      } else {
        onSearch('', opts)
      }
    }, 150)
  }, [onSearch])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    triggerSearch(val, options)
  }, [triggerSearch, options])

  // Re-trigger search when toggles change
  useEffect(() => {
    if (query.trim()) {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSearch(query, { caseSensitive, regex })
      }, 150)
    }
  }, [caseSensitive, regex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (query.trim()) onNext(query, options)
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (query.trim()) onPrev(query, options)
    }
    // Alt+C: toggle case sensitive
    if (e.altKey && e.key === 'c') {
      e.preventDefault()
      setCaseSensitive((prev) => !prev)
    }
    // Alt+E: toggle regex
    if (e.altKey && e.key === 'e') {
      e.preventDefault()
      setRegex((prev) => !prev)
    }
  }, [onNext, onPrev, onClose, query, options])

  const handleNext = () => {
    if (query.trim()) onNext(query, options)
  }

  const handlePrev = () => {
    if (query.trim()) onPrev(query, options)
  }

  const noMatch = query.trim().length > 0 && resultCount === 0

  return (
    <motion.div
      data-clui-ui
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        width: 320,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        background: colors.popoverBg,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${noMatch ? colors.statusError : colors.popoverBorder}`,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <MagnifyingGlass size={14} style={{ color: colors.textMuted, flexShrink: 0 }} />

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: colors.textPrimary,
          fontSize: 12,
          fontFamily: 'inherit',
          minWidth: 0,
        }}
      />

      {/* Case sensitive toggle */}
      <button
        onClick={() => setCaseSensitive((prev) => !prev)}
        style={{
          background: caseSensitive ? colors.accentSoft : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: caseSensitive ? colors.accent : colors.textMuted,
          padding: 2,
          display: 'flex',
          borderRadius: 3,
        }}
        title="Case Sensitive (Alt+C)"
        aria-label="Toggle case sensitive"
      >
        <TextAa size={14} />
      </button>

      {/* Regex toggle */}
      <button
        onClick={() => setRegex((prev) => !prev)}
        style={{
          background: regex ? colors.accentSoft : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: regex ? colors.accent : colors.textMuted,
          padding: 2,
          display: 'flex',
          borderRadius: 3,
        }}
        title="Regex (Alt+E)"
        aria-label="Toggle regex"
      >
        <BracketsCurly size={14} />
      </button>

      {/* Match counter */}
      {query.trim().length > 0 && (
        <span
          style={{
            fontSize: 11,
            color: noMatch ? '#f87171' : colors.textSecondary,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {noMatch ? '0/0' : `${resultIndex + 1}/${resultCount}`}
        </span>
      )}

      {/* Nav buttons */}
      <button
        onClick={handlePrev}
        disabled={resultCount === 0}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: resultCount === 0 ? 'default' : 'pointer',
          color: resultCount === 0 ? colors.textMuted : colors.textSecondary,
          opacity: resultCount === 0 ? 0.4 : 1,
          padding: 2,
          display: 'flex',
          borderRadius: 3,
        }}
        aria-label="Previous match"
      >
        <CaretUp size={14} />
      </button>
      <button
        onClick={handleNext}
        disabled={resultCount === 0}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: resultCount === 0 ? 'default' : 'pointer',
          color: resultCount === 0 ? colors.textMuted : colors.textSecondary,
          opacity: resultCount === 0 ? 0.4 : 1,
          padding: 2,
          display: 'flex',
          borderRadius: 3,
        }}
        aria-label="Next match"
      >
        <CaretDown size={14} />
      </button>

      {/* Close */}
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: colors.textSecondary,
          padding: 2,
          display: 'flex',
          borderRadius: 3,
        }}
        aria-label="Close search"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}
