/** Toggle only the requesting native window, using its actual current state. */
export function toggleAlwaysOnTop(window: Pick<Electron.BrowserWindow, 'isAlwaysOnTop' | 'setAlwaysOnTop'>): boolean {
  const next = !window.isAlwaysOnTop()
  window.setAlwaysOnTop(next)
  return window.isAlwaysOnTop()
}
