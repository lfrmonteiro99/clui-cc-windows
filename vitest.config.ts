import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'better-sqlite3': resolve(process.cwd(), 'tests/__mocks__/better-sqlite3.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts', 'tests/setup-sqlite.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: [
        'src/renderer/components/InputBar.tsx',
        'src/renderer/components/ConversationView.tsx',
        'src/renderer/components/TabStrip.tsx',
        'src/renderer/components/CommandPalette.tsx',
        'src/renderer/components/CostDashboard.tsx',
        'src/renderer/components/SettingsPopover.tsx',
        'src/renderer/components/DiffViewer.tsx',
        'src/renderer/components/WorkflowManager.tsx',
        'src/renderer/components/Toast.tsx',
        'src/renderer/components/ToastContainer.tsx',
        'src/renderer/components/ErrorBoundary.tsx',
      ],
      exclude: ['src/preload/**'],
    },
    unstubGlobals: true,
    restoreMocks: true,
  },
})
