interface DocumentWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  isMinimizable(): boolean
  minimize(): void
}

/** Call only with the application's managed document windows. */
export function minimizeAllDocumentWindows(windows: Iterable<DocumentWindow>): { attempted: number; failed: number } {
  let attempted = 0, failed = 0
  for (const window of windows) {
    try {
      if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isMinimizable()) continue
      window.minimize()
      attempted++
    } catch { failed++ }
  }
  return { attempted, failed }
}
