import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop } from './desktop-helpers'

test('macOS Quit 保存全部窗口后进程退出', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 应用退出行为')
  const session = await launchDesktop()
  const childProcess = session.app.process()
  try {
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('quit first')
    const next = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await next
    await second.locator('.cm-content').waitFor()
    await second.keyboard.press('ControlOrMeta+n')
    await second.locator('.cm-content').click()
    await second.keyboard.insertText('quit second')
    const firstWindow = await session.app.browserWindow(session.page)
    const firstId = await firstWindow.evaluate(window => window.id)
    const files = { first: path.join(session.root, 'quit-first.md'), second: path.join(session.root, 'quit-second.md') }
    await session.app.evaluate(({ dialog }, value) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      dialog.showSaveDialog = async (window) => ({ canceled: false, filePath: 'id' in window && window.id === value.firstId ? value.files.first : value.files.second })
    }, { firstId, files })
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => session.page.isClosed()).toBe(true)
    await expect.poll(() => second.isClosed()).toBe(true)
    expect(await readFile(files.first, 'utf8')).toBe('quit first')
    expect(await readFile(files.second, 'utf8')).toBe('quit second')
    await expect.poll(() => childProcess.exitCode, { timeout: 3_000 }).not.toBeNull()
  } finally { await stopDesktop(session) }
})

test('macOS Quit 取消一个窗口时保留该窗口及其草稿', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 应用退出行为')
  const session = await launchDesktop()
  try {
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('quit saved')
    const next = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await next
    await second.locator('.cm-content').waitFor()
    await second.keyboard.press('ControlOrMeta+n')
    await second.locator('.cm-content').click()
    await second.keyboard.insertText('quit retained draft')
    const firstWindow = await session.app.browserWindow(session.page)
    const firstId = await firstWindow.evaluate(window => window.id)
    const destination = path.join(session.root, 'quit-saved.md')
    await session.app.evaluate(({ dialog }, value) => {
      dialog.showMessageBox = async (window) => ({ response: 'id' in window && window.id === value.firstId ? 0 : 2, checkboxChecked: false })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: value.destination })
    }, { firstId, destination })
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => session.page.isClosed()).toBe(true)
    await expect(second.locator('.cm-content')).toContainText('quit retained draft')
    await expect(second.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    expect(await readFile(destination, 'utf8')).toBe('quit saved')
    const bootstrap = await second.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    const document = bootstrap.data.documents.find(item => item.content.includes('quit retained draft'))
    expect(document).toBeTruthy()
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(path.join(session.userData, 'drafts', `${document!.id}.json`), 'utf8')).content } catch { return '' }
    }).toBe('quit retained draft')
    expect(session.app.process().exitCode).toBeNull()
  } finally { await stopDesktop(session) }
})

test('退出确认期间新建窗口，中止退出意图且之后正常关闭不退出进程', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 应用退出行为')
  const session = await launchDesktop()
  const childProcess = session.app.process()
  try {
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('pending quit')
    await session.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => { await new Promise(resolve => setTimeout(resolve, 800)); return { response: 1, checkboxChecked: false } }
    })
    await session.app.evaluate(({ app }) => app.quit())
    const next = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await next
    await second.locator('.cm-content').waitFor()
    await expect.poll(() => session.page.isClosed()).toBe(true)
    const nativeWindow = await session.app.browserWindow(second)
    await nativeWindow.evaluate(target => target.close())
    await expect.poll(() => second.isClosed()).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(childProcess.exitCode).toBeNull()
  } finally { await stopDesktop(session) }
})

test('退出确认中系统打开文件在取消退出后仍会打开', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 系统打开文件行为')
  const session = await launchDesktop()
  try {
    const file = path.join(session.root, 'system-open.md')
    await writeFile(file, 'system open during quit')
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('unsaved before quit')
    await session.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => {
        ;(globalThis as typeof globalThis & { quitPromptEntered?: boolean }).quitPromptEntered = true
        await new Promise(resolve => setTimeout(resolve, 800))
        return { response: 2, checkboxChecked: false }
      }
    })
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { quitPromptEntered?: boolean }).quitPromptEntered)).toBe(true)
    const next = session.app.waitForEvent('window')
    await session.app.evaluate(({ app }, filePath) => {
      app.emit('open-file', { preventDefault() {} } as Electron.Event, filePath)
    }, file)
    const opened = await next
    await expect(opened.locator('.cm-content')).toContainText('system open during quit', { timeout: 5_000 })
    await expect(session.page.locator('.cm-content')).toContainText('unsaved before quit')
  } finally { await stopDesktop(session) }
})

test('取消退出后再次 Quit 可以保存并结束进程', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 应用退出行为')
  const session = await launchDesktop(), child = session.app.process()
  try {
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('quit retry')
    const destination = path.join(session.root, 'quit-retry.md')
    await session.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => {
      ;(globalThis as typeof globalThis & { quitPromptEntered?: boolean }).quitPromptEntered = true
      return { response: 2, checkboxChecked: false }
    } })
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { quitPromptEntered?: boolean }).quitPromptEntered)).toBe(true)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await session.app.evaluate(({ dialog }, filePath) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, destination)
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).not.toBeNull()
    expect(await readFile(destination, 'utf8')).toBe('quit retry')
  } finally { await stopDesktop(session) }
})

test('系统打开文件在磁盘读取过程中开始退出时仍能打开', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 系统打开文件行为')
  const session = await launchDesktop()
  try {
    const file = path.join(session.root, 'open-before-quit.md')
    await writeFile(file, 'open before close started')
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('keep original draft')
    await session.app.evaluate(({ dialog, BrowserWindow }) => {
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const original = fs.rename
      fs.rename = async (source, target) => {
        if (String(target).endsWith('/settings.json')) {
          const shared = globalThis as typeof globalThis & { openBlocked?: boolean; releaseOpen?: () => void }
          shared.openBlocked = true
          await new Promise<void>(resolve => { shared.releaseOpen = resolve })
          fs.rename = original
        }
        return original(source, target)
      }
      dialog.showMessageBox = async () => {
        ;(globalThis as typeof globalThis & { quitPromptEntered?: boolean }).quitPromptEntered = true
        await new Promise(resolve => setTimeout(resolve, 800))
        return { response: 2, checkboxChecked: false }
      }
      BrowserWindow.getAllWindows()[0].on('close', () => { (globalThis as typeof globalThis & { quitCloseSeen?: boolean }).quitCloseSeen = true })
    })
    await session.app.evaluate(({ app }, filePath) => app.emit('open-file', { preventDefault() {} } as Electron.Event, filePath), file)
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { openBlocked?: boolean }).openBlocked)).toBe(true)
    await session.app.evaluate(({ app }) => app.quit())
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { quitCloseSeen?: boolean }).quitCloseSeen)).toBe(true)
    await session.app.evaluate(() => (globalThis as typeof globalThis & { releaseOpen?: () => void }).releaseOpen?.())
    await expect(session.page.locator('.cm-content')).toContainText('open before close started')
    await expect.poll(async () => {
      const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
      return bootstrap.ok && bootstrap.data.documents.some(document => document.content === 'keep original draft')
    }).toBe(true)
  } finally { await stopDesktop(session) }
})
