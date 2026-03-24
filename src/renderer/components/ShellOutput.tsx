import React from 'react'
import { Terminal } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { ShellOutput as ShellOutputType } from '../../shared/types'

interface ShellOutputProps {
  output: ShellOutputType
}

/**
 * Renders shell command output in a terminal-styled message block.
 * stdout renders in primary text color, stderr in error color.
 */
export function ShellOutput({ output }: ShellOutputProps) {
  const colors = useColors()

  return (
    <div
      data-testid="shell-output"
      style={{
        background: colors.codeBg,
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: '18px',
        overflow: 'auto',
        maxHeight: 400,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
          color: colors.textTertiary,
          fontSize: 11,
        }}
      >
        <Terminal size={14} />
        <span style={{ fontFamily: 'inherit' }}>
          {output.command}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {output.exitCode === 0 ? 'exit 0' : `exit ${output.exitCode}`}
          {' \u00B7 '}
          {output.durationMs < 1000
            ? `${output.durationMs}ms`
            : `${(output.durationMs / 1000).toFixed(1)}s`}
        </span>
      </div>

      {/* stdout */}
      {output.stdout && (
        <pre
          data-testid="shell-stdout"
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: colors.textPrimary,
          }}
        >
          {output.stdout}
        </pre>
      )}

      {/* stderr */}
      {output.stderr && (
        <pre
          data-testid="shell-stderr"
          style={{
            margin: output.stdout ? '4px 0 0' : 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: colors.statusError,
          }}
        >
          {output.stderr}
        </pre>
      )}

      {/* Truncation notice */}
      {output.truncated && (
        <div
          data-testid="shell-truncated"
          style={{
            marginTop: 6,
            color: colors.textTertiary,
            fontSize: 11,
            fontStyle: 'italic',
          }}
        >
          Output was truncated at 50 KB
        </div>
      )}
    </div>
  )
}
