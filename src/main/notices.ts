import * as fs from 'node:fs/promises'
import { BrowserWindow } from 'electron'

const viewers = new WeakMap<BrowserWindow, BrowserWindow>()

/** Read bundled text through Electron's ASAR-aware fs, without passing virtual paths to the OS. */
export async function showThirdPartyNotices(parent: BrowserWindow, filename: string): Promise<void> {
  const existing = viewers.get(parent)
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return }
  const text = await fs.readFile(filename)
  if (parent.isDestroyed()) return
  const viewer = new BrowserWindow({ parent, title: 'QTypora 第三方许可', width: 840, height: 680, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false, spellcheck: false },
  })
  viewer.setMenuBarVisibility(false)
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  viewer.webContents.on('will-navigate', event => event.preventDefault())
  viewers.set(parent, viewer)
  try {
    await viewer.loadURL(`data:text/plain;charset=utf-8;base64,${text.toString('base64')}`)
    if (!viewer.isDestroyed()) { viewer.setTitle('QTypora 第三方许可'); viewer.show() }
  } catch (error) { if (!viewer.isDestroyed()) viewer.destroy(); throw error }
}
