import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'

export interface DesktopSession {
  app: ElectronApplication
  page: Page
  root: string
  userData: string
  errors: string[]
  initialMode: string | null
}

export async function readCreatedBytes(filePath: string): Promise<Buffer> {
  try { return await readFile(filePath) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return Buffer.alloc(0)
    throw error
  }
}

export async function readCreatedText(filePath: string): Promise<string> {
  return (await readCreatedBytes(filePath)).toString('utf8')
}

export async function launchDesktop(existingRoot?: string): Promise<DesktopSession> {
  const root = existingRoot ?? await mkdtemp(path.join(tmpdir(), 'qtypora-desktop-test-'))
  const userData = path.join(root, 'user-data')
  await mkdir(userData, { recursive: true })
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.QTYPORA_TEST_USER_DATA = userData
  const app = await _electron.launch({ args: [process.cwd()], cwd: process.cwd(), env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const session: DesktopSession = { app, page, root, userData, errors, initialMode: null }
  try {
    // Keep the user's clipboard in the isolated main process, including image/custom formats.
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const saved: Electron.ClipboardItem[] = []
      for (const item of await clipboard.read()) {
        const payload: Record<string, Blob | Electron.ClipboardBookmark> = {}
        for (const type of item.types) payload[type] = await item.getType(type)
        saved.push(new ClipboardItem(payload))
      }
      Reflect.set(globalThis, 'qtyporaTestClipboard', saved)
    })
    await expect(page.locator('.cm-content')).toBeVisible()
    session.initialMode = await page.locator('.cm-content').getAttribute('data-mode')
    // File-service fixtures edit exact source; dedicated interaction tests switch back to live preview.
    if (session.initialMode !== 'source') await page.keyboard.press('ControlOrMeta+/')
    await expect(page.locator('.cm-content')).toHaveAttribute('data-mode', 'source')
    return session
  } catch (error) {
    await stopDesktop(session, !existingRoot)
    throw error
  }
}

export async function stopDesktop(session: DesktopSession, removeRoot = true): Promise<void> {
  await session.app.evaluate(async ({ clipboard }) => {
    const saved = Reflect.get(globalThis, 'qtyporaTestClipboard') as Electron.ClipboardItem[] | undefined
    if (!saved) return
    if (saved.length) await clipboard.write(saved)
    else await clipboard.clear()
    Reflect.deleteProperty(globalThis, 'qtyporaTestClipboard')
  }).catch(() => undefined)
  await session.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await session.app.close().catch(() => undefined)
  if (removeRoot) {
    const resolved = path.resolve(session.root)
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('qtypora-desktop-test-')) {
      throw new Error(`Refusing to remove unexpected test directory: ${resolved}`)
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Select an actual Electron MenuItem through its native popup callback, in test windows only. */
export async function setContextMenuChoice(session: DesktopSession, action: string | null, hold = false): Promise<void> {
  await session.app.evaluate(({ Menu }, selection) => {
    Reflect.deleteProperty(globalThis, 'qtyporaTestPopup')
    Menu.prototype.popup = function (this: Electron.Menu, options: Electron.PopupOptions) {
      Reflect.set(globalThis, 'qtyporaTestPopup', { menu: this, options })
      if (selection.hold) return
      const item = selection.action ? this.getMenuItemById(selection.action) : undefined
      if (selection.action && (!item || !item.enabled)) throw new Error(`Context menu action is unavailable: ${selection.action}`)
      item?.click(undefined, options.window, { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
      options.callback?.()
    }
  }, { action, hold })
}

export async function contextMenuActions(session: DesktopSession): Promise<string[]> {
  return session.app.evaluate(() => {
    const pending = Reflect.get(globalThis, 'qtyporaTestPopup') as { menu: Electron.Menu } | undefined
    const actions = (items: Electron.MenuItem[]): string[] => items.flatMap(item => item.submenu ? actions(item.submenu.items) : item.type !== 'separator' ? [item.id] : [])
    return pending ? actions(pending.menu.items) : []
  })
}

export async function releaseContextMenu(session: DesktopSession, action: string | null): Promise<void> {
  await session.app.evaluate((_electron, choice) => {
    const pending = Reflect.get(globalThis, 'qtyporaTestPopup') as { menu: Electron.Menu; options: Electron.PopupOptions } | undefined
    if (!pending) throw new Error('No pending context menu')
    const item = choice ? pending.menu.getMenuItemById(choice) : undefined
    if (choice && (!item || !item.enabled)) throw new Error(`Context menu action is unavailable: ${choice}`)
    item?.click(undefined, pending.options.window, { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
    pending.options.callback?.()
  }, action)
}

export async function setOpenDialog(session: DesktopSession, filePaths: string[]): Promise<void> {
  await session.app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, filePaths)
}

export async function setSaveDialog(session: DesktopSession, filePath: string): Promise<void> {
  await session.app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, filePath)
}

export async function setMessageResponse(session: DesktopSession, response: number): Promise<void> {
  await session.app.evaluate(({ dialog }, choice) => {
    dialog.showMessageBox = async () => ({ response: choice, checkboxChecked: false })
  }, response)
}

export async function openFixture(session: DesktopSession, filename: string, content: string | Buffer): Promise<string> {
  const destination = path.join(session.root, filename)
  await writeFile(destination, content)
  await setOpenDialog(session, [destination])
  await session.page.keyboard.press('ControlOrMeta+o')
  await expect(session.page).toHaveTitle(new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await expect(session.page.locator('.cm-content')).toBeVisible()
  return destination
}

export async function appendText(session: DesktopSession, text: string): Promise<void> {
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('ControlOrMeta+End')
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (index) await session.page.keyboard.press('Enter')
    if (lines[index]) await session.page.keyboard.insertText(lines[index])
  }
}

export async function sourceText(session: DesktopSession): Promise<string> {
  return session.page.locator('.cm-content').innerText()
}

export async function clickNativeMenu(session: DesktopSession, label: string): Promise<void> {
  const clicked = await session.app.evaluate(({ Menu, BrowserWindow }, target) => {
    const search = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label.replace(/&/g, '').replace(/\([^)]*\)/g, '').trim() === target) return item
        const child = item.submenu && search(item.submenu.items)
        if (child) return child
      }
      return undefined
    }
    const menu = Menu.getApplicationMenu()
    const item = menu && search(menu.items)
    if (!item) return false
    item.click(undefined, BrowserWindow.getAllWindows()[0], { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })
    return true
  }, label)
  expect(clicked, `Native menu entry must exist: ${label}`).toBe(true)
}
