import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
)

describe('Linux build configuration (LINUX-001 / #256)', () => {
  it('has a linux section in build config', () => {
    expect(pkg.build).toBeDefined()
    expect(pkg.build.linux).toBeDefined()
  })

  it('specifies icon path', () => {
    expect(pkg.build.linux.icon).toBe('resources/icon.png')
  })

  it('targets AppImage, deb, and rpm for x64', () => {
    const targets = pkg.build.linux.target as Array<{ target: string; arch: string[] }>
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'AppImage', arch: ['x64'] }),
        expect.objectContaining({ target: 'deb', arch: ['x64'] }),
        expect.objectContaining({ target: 'rpm', arch: ['x64'] }),
      ])
    )
  })

  it('sets category to Development', () => {
    expect(pkg.build.linux.category).toBe('Development')
  })

  it('sets synopsis', () => {
    expect(pkg.build.linux.synopsis).toBe('Claude Code desktop overlay')
  })

  it('sets StartupWMClass in desktop entry', () => {
    expect(pkg.build.linux.desktop).toBeDefined()
    expect(pkg.build.linux.desktop.StartupWMClass).toBe('clui')
  })

  it('has dist:linux npm script', () => {
    expect(pkg.scripts['dist:linux']).toBeDefined()
    expect(pkg.scripts['dist:linux']).toContain('electron-builder --linux')
  })
})

describe('Tailwind oxide Linux dependency (LINUX-010 / #265)', () => {
  it('has @tailwindcss/oxide-linux-x64-gnu in optionalDependencies', () => {
    expect(pkg.optionalDependencies).toBeDefined()
    expect(pkg.optionalDependencies['@tailwindcss/oxide-linux-x64-gnu']).toBeDefined()
  })

  it('specifies a valid semver range for oxide-linux', () => {
    const version = pkg.optionalDependencies['@tailwindcss/oxide-linux-x64-gnu'] as string
    expect(version).toMatch(/^[\^~]?\d+\.\d+\.\d+/)
  })
})
