export function primaryShortcut(platform: string, keys: string): string {
  return `${platform === 'darwin' ? 'Command' : 'Ctrl'}+${keys}`
}

export function quickOpenShortcut(platform: string): string {
  return platform === 'darwin' ? 'Command+Shift+O' : 'Ctrl+P'
}

export function openFolderShortcut(platform: string): string | null {
  return platform === 'darwin' ? null : 'Ctrl+Shift+O'
}

export function redoShortcut(platform: string): string {
  return platform === 'darwin' ? 'Command+Shift+Z' : 'Ctrl+Y'
}
