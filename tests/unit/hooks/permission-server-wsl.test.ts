import { describe, it, expect, afterEach } from 'vitest'
import { PermissionServer } from '../../../src/main/hooks/permission-server'

describe('PermissionServer WSL support', () => {
  let server: PermissionServer | null = null

  afterEach(() => {
    server?.stop()
    server = null
  })

  // ─── generateSettingsFile with wslOptions ───

  describe('generateSettingsFile', () => {
    it('uses host IP when wslOptions provided', async () => {
      server = new PermissionServer(0)
      const port = await server.start()

      const runToken = server.registerRun('tab-1', 'req-1', null)
      const filePath = server.generateSettingsFile(runToken, {
        distro: 'Ubuntu',
        hostIp: '172.25.192.1',
      })

      // Read the generated file and verify the URL uses the WSL host IP
      const { readFileSync } = await import('fs')
      const content = JSON.parse(readFileSync(filePath, 'utf-8'))
      const hookUrl: string = content.hooks.PreToolUse[0].hooks[0].url

      expect(hookUrl).toContain('172.25.192.1')
      expect(hookUrl).toContain(`:${port}/`)
      expect(hookUrl).not.toContain('127.0.0.1')

      // Clean up
      server.unregisterRun(runToken)
    })

    it('uses 127.0.0.1 when no wslOptions provided', async () => {
      server = new PermissionServer(0)
      await server.start()

      const runToken = server.registerRun('tab-2', 'req-2', null)
      const filePath = server.generateSettingsFile(runToken)

      const { readFileSync } = await import('fs')
      const content = JSON.parse(readFileSync(filePath, 'utf-8'))
      const hookUrl: string = content.hooks.PreToolUse[0].hooks[0].url

      expect(hookUrl).toContain('127.0.0.1')

      server.unregisterRun(runToken)
    })

    it('uses 127.0.0.1 when wslOptions has 127.0.0.1 hostIp (mirrored mode)', async () => {
      server = new PermissionServer(0)
      await server.start()

      const runToken = server.registerRun('tab-3', 'req-3', null)
      const filePath = server.generateSettingsFile(runToken, {
        distro: 'Ubuntu',
        hostIp: '127.0.0.1',
      })

      const { readFileSync } = await import('fs')
      const content = JSON.parse(readFileSync(filePath, 'utf-8'))
      const hookUrl: string = content.hooks.PreToolUse[0].hooks[0].url

      expect(hookUrl).toContain('127.0.0.1')

      server.unregisterRun(runToken)
    })
  })

  // ─── enableWslAccess / disableWslAccess ───

  describe('enableWslAccess / disableWslAccess', () => {
    it('enableWslAccess is callable and does not throw', async () => {
      server = new PermissionServer(0)
      await server.start()

      // Should not throw
      await server.enableWslAccess()

      // Server should still be functional (port preserved as non-null)
      expect(server.getPort()).not.toBeNull()
    })

    it('disableWslAccess is callable and does not throw', async () => {
      server = new PermissionServer(0)
      await server.start()

      // Should not throw
      await server.disableWslAccess()

      expect(server.getPort()).not.toBeNull()
    })

    it('enableWslAccess then disableWslAccess round-trips without error', async () => {
      server = new PermissionServer(0)
      await server.start()
      const port = server.getPort()

      await server.enableWslAccess()
      expect(server.getPort()).toBe(port)

      await server.disableWslAccess()
      expect(server.getPort()).toBe(port)
    })

    it('enableWslAccess is no-op when server not started', async () => {
      server = new PermissionServer(0)
      // Not started — should not throw
      await server.enableWslAccess()
    })

    it('disableWslAccess is no-op when server not started', async () => {
      server = new PermissionServer(0)
      // Not started — should not throw
      await server.disableWslAccess()
    })
  })
})
