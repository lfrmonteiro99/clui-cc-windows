import { create } from 'zustand'

export interface ContextMenuItem {
  id: string
  label: string
  icon: string          // Phosphor icon name (resolved in component)
  shortcut?: string     // display hint like 'Ctrl+Click'
  disabled?: boolean
  danger?: boolean
}

interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  filePath: string | null
  workingDirectory: string | null
  items: ContextMenuItem[]
  focusedIndex: number

  // Actions
  openMenu: (position: { x: number; y: number }, filePath: string, workingDirectory: string) => void
  closeMenu: () => void
  setFocusedIndex: (index: number) => void
}

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')

const FILE_CONTEXT_ITEMS: ContextMenuItem[] = [
  { id: 'peek', label: 'Peek File', icon: 'Eye', shortcut: 'Ctrl+Click' },
  { id: 'copy-path', label: 'Copy Path', icon: 'Copy' },
  { id: 'reveal', label: isMac ? 'Reveal in Finder' : 'Reveal in Explorer', icon: 'FolderOpen' },
  { id: 'open-external', label: 'Open in Editor', icon: 'ArrowSquareOut' },
]

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  filePath: null,
  workingDirectory: null,
  items: FILE_CONTEXT_ITEMS,
  focusedIndex: -1,

  openMenu: (position, filePath, workingDirectory) => set({
    isOpen: true,
    position,
    filePath,
    workingDirectory,
    items: FILE_CONTEXT_ITEMS,
    focusedIndex: -1,
  }),

  closeMenu: () => set({
    isOpen: false,
    focusedIndex: -1,
  }),

  setFocusedIndex: (index) => set({ focusedIndex: index }),
}))
