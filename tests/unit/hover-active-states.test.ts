import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const cssPath = resolve(__dirname, '../../src/renderer/index.css')
const css = readFileSync(cssPath, 'utf-8')

describe('Hover/active state CSS classes', () => {
  it('defines .clui-btn class with hover and active states', () => {
    expect(css).toContain('.clui-btn {')
    expect(css).toContain('.clui-btn:hover')
    expect(css).toContain('.clui-btn:active')
  })

  it('defines .clui-btn-ghost class with hover and active states', () => {
    expect(css).toContain('.clui-btn-ghost {')
    expect(css).toContain('.clui-btn-ghost:hover')
    expect(css).toContain('.clui-btn-ghost:active')
  })

  it('defines .clui-row-interactive class with hover state', () => {
    expect(css).toContain('.clui-row-interactive {')
    expect(css).toContain('.clui-row-interactive:hover')
  })

  it('defines disabled state for .clui-btn that removes hover effects', () => {
    expect(css).toContain('.clui-btn:disabled')
    // Disabled buttons should not scale or filter
    const disabledBlock = css.slice(
      css.indexOf('.clui-btn:disabled,'),
      css.indexOf('}', css.indexOf('.clui-btn:disabled,')) + 1,
    )
    expect(disabledBlock).toContain('transform: none')
    expect(disabledBlock).toContain('filter: none')
    expect(disabledBlock).toContain('cursor: default')
  })

  it('defines disabled state for .clui-btn-ghost that removes hover effects', () => {
    expect(css).toContain('.clui-btn-ghost:disabled')
    const disabledBlock = css.slice(
      css.indexOf('.clui-btn-ghost:disabled,'),
      css.indexOf('}', css.indexOf('.clui-btn-ghost:disabled,')) + 1,
    )
    expect(disabledBlock).toContain('transform: none')
    expect(disabledBlock).toContain('background-color: transparent')
    expect(disabledBlock).toContain('cursor: default')
  })

  it('preserves existing .clui-pressable and .clui-interactive classes', () => {
    expect(css).toContain('.clui-pressable')
    expect(css).toContain('.clui-interactive')
  })
})
