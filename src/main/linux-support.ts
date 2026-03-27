/**
 * Linux-specific support utilities.
 *
 * LINUX-004: Wayland global shortcut fallback + multi-workspace visibility.
 */

/**
 * Returns true when the current session is running under a Wayland compositor.
 * Checks both `XDG_SESSION_TYPE` and `WAYLAND_DISPLAY` environment variables.
 * LINUX-011: Wayland breaks setIgnoreMouseEvents({ forward: true }), making the app unclickable.
 */
export function isWaylandSession(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.XDG_SESSION_TYPE === 'wayland') return true
  if (process.env.WAYLAND_DISPLAY) return true
  return false
}

/**
 * Register a global shortcut with graceful Wayland fallback.
 *
 * On Wayland, Electron's globalShortcut.register() may throw because
 * the compositor does not support X11-style global keybindings.
 * This wrapper catches the error on Wayland and logs a helpful warning
 * instead of crashing the app. On non-Wayland sessions, exceptions
 * are re-thrown so real bugs surface.
 *
 * @returns true if registration succeeded, false otherwise
 */
export function registerGlobalShortcutSafe(
  accelerator: string,
  callback: () => void,
  registerFn: (accelerator: string, callback: () => void) => boolean,
  logFn: (msg: string) => void,
): boolean {
  try {
    return registerFn(accelerator, callback)
  } catch (err) {
    if (isWaylandSession()) {
      logFn(
        `[linux] Global shortcut "${accelerator}" failed on Wayland — ` +
        `Wayland compositors often block X11-style global keybindings. ` +
        `Use the tray icon or D-Bus activation instead. Error: ${err}`,
      )
      return false
    }
    // Non-Wayland: re-throw so the error is visible
    throw err
  }
}

/**
 * Make the window visible on all Linux workspaces/virtual desktops.
 *
 * On macOS this is handled separately (with { visibleOnFullScreen: true }).
 * On Windows virtual desktops behave differently and this is a no-op.
 */
export function applyLinuxWorkspaceVisibility(
  window: { setVisibleOnAllWorkspaces: (visible: boolean) => void },
): void {
  if (process.platform === 'linux') {
    window.setVisibleOnAllWorkspaces(true)
  }
}
