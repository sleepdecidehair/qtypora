import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('取消关闭不入栈，明确放弃后可重新打开磁盘文件', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'reopen-example.md', '原始正文')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('未保存修改')
    await session.app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, 'reopenTestChoice', 2)
      dialog.showMessageBox = async () => ({ response: Number(Reflect.get(globalThis, 'reopenTestChoice')), checkboxChecked: false })
    })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).toHaveTitle(/reopen-example\.md/)
    const empty = await session.page.evaluate(() => window.desktop.reopenClosedFile())
    expect(empty.ok && empty.data).toBeNull()
    await session.app.evaluate(() => { Reflect.set(globalThis, 'reopenTestChoice', 1) })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).not.toHaveTitle(/reopen-example\.md/)
    await session.page.keyboard.press('ControlOrMeta+Shift+t')
    await expect(session.page).toHaveTitle(/reopen-example\.md/)
    const text = await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })
    expect(text).toBe('原始正文')
    expect(await readFile(file, 'utf8')).toBe('原始正文')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('关闭确认期间到达的异步编辑会保留并阻止关闭', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'close-race.md', '原文')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('已输入')
    await session.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => new Promise(resolve => {
        Reflect.set(globalThis, 'closeRaceResolve', resolve)
      })
    })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'closeRaceResolve'))).toBe('function')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ changes: { from: view.state.doc.length, insert: '异步结果' } })
    })
    await session.app.evaluate(() => {
      const resolve = Reflect.get(globalThis, 'closeRaceResolve') as (answer: { response: number; checkboxChecked: boolean }) => void
      resolve({ response: 1, checkboxChecked: false })
    })
    await expect(session.page).toHaveTitle(/close-race\.md/)
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe('原文已输入异步结果')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
  } finally { await stopDesktop(session) }
})

test('表格输入法组合期间拒绝关闭，结束后取消关闭仍保留内容', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'close-table.md', '| A | B |\n| --- | --- |\n| one | two |\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page.getByText('请先结束输入法输入后再关闭。')).toBeVisible()
    await expect(session.page).toHaveTitle(/close-table\.md/)
    await cell.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('修改')
    await session.app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, 'tableClosePrompted', false)
      dialog.showMessageBox = async () => {
        Reflect.set(globalThis, 'tableClosePrompted', true)
        return { response: 2, checkboxChecked: false }
      }
    })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'tableClosePrompted'))).toBe(true)
    await expect(session.page).toHaveTitle(/close-table\.md/)
    await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toContain('one修改')
    await expect(cell).toBeFocused()
  } finally { await stopDesktop(session) }
})

test('最终校验后迟到的打开事件重新取得有效文档，不生成幽灵标签', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'late-open.md', '磁盘原文')
    const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    const record = bootstrap.data.documents.find(document => document.name === 'late-open.md')
    if (!record) throw new Error('missing test document')
    await session.app.evaluate(({ ipcMain, dialog }, record) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const handlers = Reflect.get(ipcMain, '_invokeHandlers') as Map<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>
      const handler = handlers.get('qtypora:resolveCloseValidation')!
      ipcMain.removeHandler('qtypora:resolveCloseValidation')
      let count = 0
      ipcMain.handle('qtypora:resolveCloseValidation', async (event, ...args) => {
        const result = await handler(event, ...args)
        if (++count === 2) event.sender.send('qtypora:event', { type: 'open-document', document: record })
        return result
      })
    }, record)
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).toHaveTitle(/late-open\.md/)
    const editor = session.page.locator('.cm-content')
    await expect.poll(async () => {
      const result = await session.page.evaluate(() => window.desktop.bootstrap())
      return result.ok ? result.data.documents.find(document => document.name === 'late-open.md')?.id : undefined
    }).not.toBe(record.id)
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('新编辑')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(async () => await readFile(record.path!, 'utf8')).toBe('磁盘原文新编辑')
  } finally { await stopDesktop(session) }
})

test('最终校验响应后到达的编辑应保留', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'late-edit.md', '原文')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('已输入')
    await session.app.evaluate(({ ipcMain, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const handlers = Reflect.get(ipcMain, '_invokeHandlers') as Map<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>
      const handler = handlers.get('qtypora:resolveCloseValidation')!
      ipcMain.removeHandler('qtypora:resolveCloseValidation')
      let count = 0
      ipcMain.handle('qtypora:resolveCloseValidation', async (event, ...args) => {
        const result = await handler(event, ...args)
        if (++count === 2) await event.sender.executeJavaScript(`(() => {
          const el = document.querySelector('.cm-content');
          const view = el.cmTile.root.view;
          view.dispatch({ changes: { from: view.state.doc.length, insert: '迟到编辑' } });
        })()`)
        return result
      })
    })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).toHaveTitle(/late-edit\.md/)
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe('原文已输入迟到编辑')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect.poll(async () => {
      const result = await session.page.evaluate(() => window.desktop.bootstrap())
      return result.ok ? result.data.documents.find(document => document.name === 'late-edit.md')?.content : undefined
    }).toBe('原文已输入迟到编辑')
  } finally { await stopDesktop(session) }
})

test('窗口最终校验后到达的编辑会阻止卸载并保留草稿', async () => {
  const session = await launchDesktop()
  try {
    // Electron handles beforeunload through will-prevent-unload itself; avoid
    // Playwright's automatic JavaScript-dialog reply to a native cancellation.
    session.page.on('dialog', () => {})
    await openFixture(session, 'late-window.md', '窗口原文')
    const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    const record = bootstrap.data.documents.find(document => document.name === 'late-window.md')
    if (!record) throw new Error('missing test document')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('已输入')
    await session.app.evaluate(({ ipcMain, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const handlers = Reflect.get(ipcMain, '_invokeHandlers') as Map<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>
      const handler = handlers.get('qtypora:resolveCloseValidation')!
      const syncHandler = handlers.get('qtypora:syncDocument')!
      ipcMain.removeHandler('qtypora:syncDocument')
      ipcMain.handle('qtypora:syncDocument', async (event, ...args) => {
        if (Reflect.get(globalThis, 'failLateSync')) {
          Reflect.set(globalThis, 'lateSyncFailures', Number(Reflect.get(globalThis, 'lateSyncFailures') || 0) + 1)
          return { ok: false, error: { code: 'IO_ERROR', message: 'injected draft failure' } }
        }
        return syncHandler(event, ...args)
      })
      ipcMain.removeHandler('qtypora:resolveCloseValidation')
      let count = 0
      ipcMain.handle('qtypora:resolveCloseValidation', async (event, ...args) => {
        const result = await handler(event, ...args)
        if (++count === 2) {
          Reflect.set(globalThis, 'failLateSync', true)
          await event.sender.executeJavaScript(`(() => {
          const view = document.querySelector('.cm-content').cmTile.root.view;
          view.dispatch({ changes: { from: view.state.doc.length, insert: '迟到编辑' } });
        })()`)
        }
        return result
      })
    })
    const nativeWindow = await session.app.browserWindow(session.page)
    await nativeWindow.evaluate(window => window.close())
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe('窗口原文已输入迟到编辑')
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect.poll(() => session.app.evaluate(() => Number(Reflect.get(globalThis, 'lateSyncFailures') || 0))).toBeGreaterThan(0)
    await session.app.evaluate(() => { Reflect.set(globalThis, 'failLateSync', false) })
    await expect(session.page).toHaveTitle(/late-window\.md/)
    await expect.poll(async () => {
      try {
        const draft = JSON.parse(await readFile(path.join(session.userData, 'drafts', `${record.id}.json`), 'utf8')) as { content: string }
        return draft.content
      } catch { return '' }
    }).toContain('迟到编辑')
    await editor.click()
    await session.page.keyboard.insertText('继续')
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toContain('继续')
    await nativeWindow.evaluate(window => window.close())
    await expect.poll(() => session.page.isClosed()).toBe(true)
  } finally { await stopDesktop(session) }
})

test('迟到的已有文档打开事件不会覆盖另一标签的未保存输入', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'other-edit.md', '另一篇')
    const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    const stale = bootstrap.data.documents.find(document => document.name === 'other-edit.md')
    if (!stale) throw new Error('missing test document')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('未保存输入')
    await openFixture(session, 'closing-other.md', '即将关闭')
    await session.app.evaluate(({ ipcMain }, stale) => {
      const handlers = Reflect.get(ipcMain, '_invokeHandlers') as Map<string, (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>
      const handler = handlers.get('qtypora:resolveCloseValidation')!
      ipcMain.removeHandler('qtypora:resolveCloseValidation')
      let count = 0
      ipcMain.handle('qtypora:resolveCloseValidation', async (event, ...args) => {
        const result = await handler(event, ...args)
        if (++count === 2) event.sender.send('qtypora:event', { type: 'open-document', document: stale })
        return result
      })
    }, stale)
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).toHaveTitle(/other-edit\.md/)
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe('另一篇未保存输入')
  } finally { await stopDesktop(session) }
})

test('切换标签完成后才解除已关闭文档的编辑保护', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'remaining-switch.md', '保留文档')
    await openFixture(session, 'closing-switch.md', '待关闭文档')
    await session.page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'inert')!
      Object.defineProperty(HTMLElement.prototype, 'inert', {
        configurable: true,
        get: descriptor.get,
        set(value: boolean) {
          descriptor.set!.call(this, value)
          if (!value && this.classList.contains('markdown-editor')) {
            const element = this.querySelector('.cm-content')
            const view = element && Reflect.get(element, 'cmTile')?.root.view as import('@codemirror/view').EditorView | undefined
            Reflect.set(window, 'closeUnlockDocument', view?.state.doc.toString())
          }
        },
      })
    })
    await session.page.keyboard.press('ControlOrMeta+w')
    await expect(session.page).toHaveTitle(/remaining-switch\.md/)
    await expect.poll(() => session.page.evaluate(() => Reflect.get(window, 'closeUnlockDocument'))).toBe('保留文档')
  } finally { await stopDesktop(session) }
})

test('关闭窗口时保存第一篇后取消第二篇，已保存路径和状态同步', async () => {
  const session = await launchDesktop()
  try {
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('first unsaved')
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('second unsaved')
    const filename = path.join(session.root, 'saved-during-close.md')
    await session.app.evaluate(({ dialog }, filename) => {
      Reflect.set(globalThis, 'closeSaveCount', 0)
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename })
      dialog.showMessageBox = async () => {
        const count = Number(Reflect.get(globalThis, 'closeSaveCount')) + 1
        Reflect.set(globalThis, 'closeSaveCount', count)
        return { response: count === 1 ? 0 : 2, checkboxChecked: false }
      }
    }, filename)
    const nativeWindow = await session.app.browserWindow(session.page)
    await nativeWindow.evaluate(window => window.close())
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'closeSaveCount'))).toBe(2)
    expect(await readFile(filename, 'utf8')).toBe('first unsaved')
    await expect(session.page.locator('.cm-content')).toContainText('second unsaved')
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    const result = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!result.ok) throw new Error(result.error.message)
    expect(result.data.documents.find(document => document.name === 'saved-during-close.md')?.content).toBe('first unsaved')
    for (let index = 0; index < 3; index++) {
      const title = await session.page.title()
      if (title.includes('saved-during-close.md')) break
      await nativeWindow.evaluate(window => window.webContents.send('qtypora:event', { type: 'command', command: 'next-document' }))
      await expect.poll(() => session.page.title()).not.toBe(title)
    }
    await expect(session.page).toHaveTitle(/^saved-during-close\.md/)
    await expect(session.page.locator('.statusbar-left')).toContainText('已保存')
  } finally { await stopDesktop(session) }
})

test('关闭中保存后出现外部修改，取消关闭不会清除较新的警告', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'external-after-close-save.md', 'original')
    const bootstrap = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    const first = bootstrap.data.documents.find(document => document.name === 'external-after-close-save.md')
    if (!first) throw new Error('missing test document')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText(' edited')
    await session.page.keyboard.press('ControlOrMeta+n')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.insertText('another draft')
    const nativeWindow = await session.app.browserWindow(session.page)
    await session.app.evaluate(({ dialog, BrowserWindow }, firstId) => {
      Reflect.set(globalThis, 'closeMetaCount', 0)
      Reflect.set(globalThis, 'closeMetaChanged', false)
      const window = BrowserWindow.getAllWindows()[0]
      const send = window.webContents.send.bind(window.webContents)
      window.webContents.send = (channel: string, ...args: unknown[]) => {
        const payload = args[0] as { type?: string; id?: string; kind?: string } | undefined
        if (channel === 'qtypora:event' && payload?.type === 'document-changed' && payload.id === firstId && payload.kind === 'changed') Reflect.set(globalThis, 'closeMetaChanged', true)
        send(channel, ...args)
      }
      dialog.showMessageBox = async () => {
        const count = Number(Reflect.get(globalThis, 'closeMetaCount')) + 1
        Reflect.set(globalThis, 'closeMetaCount', count)
        if (count === 1) return { response: 0, checkboxChecked: false }
        return new Promise(resolve => { Reflect.set(globalThis, 'closeMetaResolve', resolve) })
      }
    }, first.id)
    await nativeWindow.evaluate(window => window.close())
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'closeMetaResolve'))).toBe('function')
    expect(await readFile(filename, 'utf8')).toBe('original edited')
    await writeFile(filename, 'external later')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'closeMetaChanged'))).toBe(true)
    await session.app.evaluate(() => {
      const resolve = Reflect.get(globalThis, 'closeMetaResolve') as (result: { response: number; checkboxChecked: boolean }) => void
      resolve({ response: 2, checkboxChecked: false })
    })
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    for (let index = 0; index < 3; index++) {
      const title = await session.page.title()
      if (title.includes('external-after-close-save.md')) break
      await nativeWindow.evaluate(window => window.webContents.send('qtypora:event', { type: 'command', command: 'next-document' }))
      await expect.poll(() => session.page.title()).not.toBe(title)
    }
    await expect(session.page).toHaveTitle(/external-after-close-save\.md/)
    await expect(session.page.getByText('磁盘上的文件已更改，当前编辑仍然保留。')).toBeVisible()
    await expect(session.page.locator('.cm-content')).toContainText('original edited')
    expect(await readFile(filename, 'utf8')).toBe('external later')
  } finally { await stopDesktop(session) }
})
