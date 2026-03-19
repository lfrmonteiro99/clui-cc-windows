import { create } from 'zustand'

interface FilePeekState {
  // Panel state
  isOpen: boolean
  filePath: string | null         // absolute path being viewed
  displayPath: string | null      // shortened for display (relative to working dir)
  content: string | null
  language: string | null
  lineCount: number
  truncated: boolean
  fileSize: number
  loading: boolean
  error: string | null
  errorType: 'not_found' | 'too_large' | 'binary' | 'permission_denied' | 'outside_workspace' | null

  // Actions
  openPeek: (filePath: string, workingDirectory: string) => Promise<void>
  closePeek: () => void
}

export const useFilePeekStore = create<FilePeekState>((set, get) => ({
  isOpen: false,
  filePath: null,
  displayPath: null,
  content: null,
  language: null,
  lineCount: 0,
  truncated: false,
  fileSize: 0,
  loading: false,
  error: null,
  errorType: null,

  openPeek: async (filePath, workingDirectory) => {
    // If same file is already open, just ensure panel is visible
    if (get().filePath === filePath && get().isOpen && !get().error) return

    set({
      isOpen: true,
      filePath,
      displayPath: filePath.startsWith(workingDirectory)
        ? filePath.slice(workingDirectory.length + 1)
        : filePath,
      content: null,
      language: null,
      lineCount: 0,
      truncated: false,
      fileSize: 0,
      loading: true,
      error: null,
      errorType: null,
    })

    try {
      const result = await window.clui.fileRead(workingDirectory, filePath)
      if (result.ok) {
        set({
          content: result.content,
          language: result.language,
          lineCount: result.lineCount,
          truncated: result.truncated,
          fileSize: result.fileSize,
          loading: false,
        })
      } else {
        set({
          loading: false,
          error: result.message,
          errorType: result.error as FilePeekState['errorType'],
        })
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to read file',
        errorType: null,
      })
    }
  },

  closePeek: () => set({
    isOpen: false,
    // Keep filePath/content cached so AnimatePresence exit animation
    // doesn't flash empty content
  }),
}))
