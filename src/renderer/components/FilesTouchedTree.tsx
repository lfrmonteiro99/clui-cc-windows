import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretRight, CaretDown, File, FolderSimple } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { FileEntry } from '../../shared/tool-enrichment'

// ─── Constants ───

const AUTO_COLLAPSE_THRESHOLD = 5

// ─── Helpers ───

interface DirNode {
  name: string
  /** Full path of this directory segment */
  fullPath: string
  children: Map<string, DirNode>
  files: Array<{ name: string; entry: FileEntry }>
}

function buildTree(entries: FileEntry[]): DirNode {
  const root: DirNode = { name: '', fullPath: '', children: new Map(), files: [] }

  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, '/').split('/')
    const fileName = parts.pop() || entry.path

    let current = root
    for (const part of parts) {
      let child = current.children.get(part)
      if (!child) {
        const parentPath = current.fullPath ? `${current.fullPath}/${part}` : part
        child = { name: part, fullPath: parentPath, children: new Map(), files: [] }
        current.children.set(part, child)
      }
      current = child
    }
    current.files.push({ name: fileName, entry })
  }

  return root
}

function formatOps(operations: FileEntry['operations']): string {
  return operations.join(', ')
}

// ─── Components ───

function OperationBadges({
  operations,
  colors,
}: {
  operations: FileEntry['operations']
  colors: ReturnType<typeof useColors>
}) {
  return (
    <span
      className="text-[10px] ml-1.5"
      style={{ color: colors.textMuted }}
    >
      ({formatOps(operations)})
    </span>
  )
}

function FileNode({
  name,
  entry,
  colors,
  isLast,
  depth,
}: {
  name: string
  entry: FileEntry
  colors: ReturnType<typeof useColors>
  isLast: boolean
  depth: number
}) {
  const prefix = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
  const indent = depth > 0 ? '\u2502   '.repeat(depth - 1) + prefix : prefix

  return (
    <div
      className="flex items-center text-[11px] font-mono leading-[1.6]"
      style={{ color: colors.textSecondary }}
    >
      <span style={{ color: colors.textMuted, whiteSpace: 'pre' }}>{indent}</span>
      <File size={12} className="flex-shrink-0 mr-1" style={{ color: colors.textMuted }} />
      <span className="truncate">{name}</span>
      <OperationBadges operations={entry.operations} colors={colors} />
    </div>
  )
}

function DirTreeNode({
  node,
  colors,
  isLast,
  depth,
}: {
  node: DirNode
  colors: ReturnType<typeof useColors>
  isLast: boolean
  depth: number
}) {
  const prefix = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
  const indent = depth > 0 ? '\u2502   '.repeat(depth - 1) + prefix : prefix

  const childDirs = Array.from(node.children.values())
  const totalChildren = childDirs.length + node.files.length

  return (
    <div>
      <div
        className="flex items-center text-[11px] font-mono leading-[1.6]"
        style={{ color: colors.textSecondary }}
      >
        <span style={{ color: colors.textMuted, whiteSpace: 'pre' }}>{indent}</span>
        <FolderSimple size={12} className="flex-shrink-0 mr-1" style={{ color: colors.accent }} />
        <span>{node.name}/</span>
      </div>
      {/* Render child directories */}
      {childDirs.map((child, i) => {
        const isLastChild = i === childDirs.length - 1 && node.files.length === 0
        return (
          <DirTreeNode
            key={child.fullPath}
            node={child}
            colors={colors}
            isLast={isLastChild}
            depth={depth + 1}
          />
        )
      })}
      {/* Render files */}
      {node.files.map((file, i) => (
        <FileNode
          key={`${node.fullPath}/${file.name}`}
          name={file.name}
          entry={file.entry}
          colors={colors}
          isLast={i === node.files.length - 1}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

// ─── Main Component ───

export interface FilesTouchedTreeProps {
  files: FileEntry[]
}

export const FilesTouchedTree = React.memo(function FilesTouchedTree({ files }: FilesTouchedTreeProps) {
  const colors = useColors()
  const shouldStartCollapsed = files.length > AUTO_COLLAPSE_THRESHOLD
  const [collapsed, setCollapsed] = useState(shouldStartCollapsed)

  const tree = useMemo(() => buildTree(files), [files])

  if (files.length === 0) return null

  const rootDirs = Array.from(tree.children.values())
  const rootFiles = tree.files
  const totalRootItems = rootDirs.length + rootFiles.length

  return (
    <div
      className="rounded-lg overflow-hidden mt-2"
      style={{
        background: colors.surfaceHover,
        border: `1px solid ${colors.toolBorder}`,
      }}
      data-testid="files-touched-tree"
    >
      {/* Header */}
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] font-medium cursor-pointer select-none"
        style={{ color: colors.textSecondary, background: 'transparent', border: 'none' }}
        onClick={() => setCollapsed((prev) => !prev)}
        data-testid="files-touched-toggle"
      >
        {collapsed ? (
          <CaretRight size={12} style={{ color: colors.textMuted }} />
        ) : (
          <CaretDown size={12} style={{ color: colors.textMuted }} />
        )}
        Files touched ({files.length})
      </button>

      {/* Tree body */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2" data-testid="files-touched-body">
              {rootDirs.map((dir, i) => {
                const isLast = i === rootDirs.length - 1 && rootFiles.length === 0
                return (
                  <DirTreeNode
                    key={dir.fullPath}
                    node={dir}
                    colors={colors}
                    isLast={isLast}
                    depth={0}
                  />
                )
              })}
              {rootFiles.map((file, i) => (
                <FileNode
                  key={file.entry.path}
                  name={file.name}
                  entry={file.entry}
                  colors={colors}
                  isLast={i === rootFiles.length - 1}
                  depth={0}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
