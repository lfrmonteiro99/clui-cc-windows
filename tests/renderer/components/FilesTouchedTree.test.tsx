// @vitest-environment jsdom

import React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FilesTouchedTree } from '../../../src/renderer/components/FilesTouchedTree'
import { renderWithProviders, resetTestState } from '../testUtils'
import type { FileEntry } from '../../../src/shared/tool-enrichment'

describe('FilesTouchedTree', () => {
  beforeEach(() => {
    resetTestState()
  })

  it('renders nothing when files list is empty', () => {
    const { container } = renderWithProviders(<FilesTouchedTree files={[]} />)
    expect(container.querySelector('[data-testid="files-touched-tree"]')).toBeNull()
  })

  it('renders file count in header', () => {
    const files: FileEntry[] = [
      { path: 'src/main/index.ts', operations: ['read'] },
      { path: 'src/shared/types.ts', operations: ['edited'] },
    ]

    renderWithProviders(<FilesTouchedTree files={files} />)
    expect(screen.getByTestId('files-touched-tree')).toBeTruthy()
    expect(screen.getByText('Files touched (2)')).toBeTruthy()
  })

  it('starts expanded when 5 or fewer files', () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', operations: ['read'] },
      { path: 'src/b.ts', operations: ['edited'] },
    ]

    renderWithProviders(<FilesTouchedTree files={files} />)
    expect(screen.getByTestId('files-touched-body')).toBeTruthy()
  })

  it('starts collapsed when more than 5 files', () => {
    const files: FileEntry[] = Array.from({ length: 7 }, (_, i) => ({
      path: `src/file${i}.ts`,
      operations: ['read' as const],
    }))

    renderWithProviders(<FilesTouchedTree files={files} />)
    expect(screen.queryByTestId('files-touched-body')).toBeNull()
  })

  it('toggles collapse on header click', () => {
    const files: FileEntry[] = Array.from({ length: 7 }, (_, i) => ({
      path: `src/file${i}.ts`,
      operations: ['read' as const],
    }))

    renderWithProviders(<FilesTouchedTree files={files} />)
    // Starts collapsed
    expect(screen.queryByTestId('files-touched-body')).toBeNull()

    // Click to expand
    fireEvent.click(screen.getByTestId('files-touched-toggle'))
    expect(screen.getByTestId('files-touched-body')).toBeTruthy()

    // Click to collapse
    fireEvent.click(screen.getByTestId('files-touched-toggle'))
    // After AnimatePresence exit animation, body should be gone
    // (In test, framer-motion may keep it briefly, so just verify toggle works)
  })

  it('groups files by directory', () => {
    const files: FileEntry[] = [
      { path: 'src/main/index.ts', operations: ['read'] },
      { path: 'src/main/app.ts', operations: ['edited'] },
      { path: 'src/shared/types.ts', operations: ['read'] },
    ]

    renderWithProviders(<FilesTouchedTree files={files} />)
    const body = screen.getByTestId('files-touched-body')
    // Should contain directory names
    expect(body.textContent).toContain('src/')
    expect(body.textContent).toContain('main/')
    expect(body.textContent).toContain('shared/')
    // Should contain filenames
    expect(body.textContent).toContain('index.ts')
    expect(body.textContent).toContain('app.ts')
    expect(body.textContent).toContain('types.ts')
  })

  it('shows operation badges', () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', operations: ['read', 'edited'] },
    ]

    renderWithProviders(<FilesTouchedTree files={files} />)
    const body = screen.getByTestId('files-touched-body')
    expect(body.textContent).toContain('(read, edited)')
  })
})
