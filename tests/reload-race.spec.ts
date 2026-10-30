import { test, expect } from '@playwright/test'
import { mkdir, readFile, readdir, realpath, rename, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('重新载入期间保存不能用旧正文覆盖磁盘', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'reload-save-race.md', 'disk before')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.insertText(' local')
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => (await readdir(folder).catch(() => [])).some(name => name.endsWith('.json'))).toBe(true)
    await writeFile(filename, 'disk changed')
    await expect(session.page.locator('.external-change')).toBeVisible()
    await session.app.evaluate((_electron, target) => {
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const originalOpen = fs.open
      Reflect.set(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]) === target) {
          Reflect.set(fs, 'open', originalOpen)
          Reflect.set(globalThis, 'reloadReadBlocked', true)
          await new Promise<void>(resolve => { Reflect.set(globalThis, 'releaseReloadRead', resolve) })
        }
        return originalOpen(...args)
      })

    }, await realpath(filename))
    await session.page.locator('.external-change').getByRole('button', { name: '重新载入' }).click()
    await session.page.getByRole('dialog', { name: '重新载入文件' }).getByRole('button', { name: '重新载入', exact: true }).click()
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'reloadReadBlocked'))).toBe(true)
    await clickNativeMenu(session, '保存')
    await expect(session.page.getByRole('alert')).toContainText('正在重新载入')
    const blocked = await session.page.evaluate(async () => {
      const result = await window.desktop.bootstrap()
      if (!result.ok) throw new Error(result.error.message)
      const document = result.data.documents.find(item => item.name === 'reload-save-race.md')
      if (!document) throw new Error('fixture document missing')
      return window.desktop.saveDocument({ id: document.id, content: 'disk before local', revision: 999, pendingLineEnding: null })
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('CONFLICT')
    await session.app.evaluate(() => (Reflect.get(globalThis, 'releaseReloadRead') as () => void)())
    await expect(session.page.locator('.cm-content')).toHaveText('disk changed')
    await expect(session.page.getByTestId('save-document')).toBeEnabled()
    expect(await readFile(filename, 'utf8')).toBe('disk changed')
  } finally { await stopDesktop(session) }
})

test('保存对话框期间重新载入被拒绝，取消后可重试', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'save-reload-race.md', 'original')
    const document = await session.page.evaluate(async () => {
      const result = await window.desktop.bootstrap()
      if (!result.ok) throw new Error(result.error.message)
      const found = result.data.documents.find(item => item.name === 'save-reload-race.md')
      if (!found) throw new Error('fixture document missing')
      return found
    })
    await session.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'releaseSaveDialog', resolve) })
    })
    const save = session.page.evaluate(record => window.desktop.saveDocument({ id: record.id, content: record.content, revision: 0, saveAs: true }), document)
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'releaseSaveDialog'))).toBe('function')
    const blocked = await session.page.evaluate(id => window.desktop.reloadDocument(id), document.id)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('CONFLICT')
    await session.app.evaluate(() => (Reflect.get(globalThis, 'releaseSaveDialog') as (value: { canceled: boolean; filePath: string }) => void)({ canceled: true, filePath: '' }))
    const cancelled = await save
    expect(cancelled.ok && cancelled.data).toBe(null)
    const retried = await session.page.evaluate(id => window.desktop.reloadDocument(id), document.id)
    expect(retried.ok).toBe(true)
    expect(await readFile(filename, 'utf8')).toBe('original')
  } finally { await stopDesktop(session) }
})

test('重新载入等待草稿清理期间迟到的编辑仍保留', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'reload-late.md', 'disk before')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.insertText(' local')
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => (await readdir(folder).catch(() => [])).length).toBeGreaterThan(0)
    await writeFile(filename, 'disk changed')
    await expect(session.page.locator('.external-change')).toBeVisible()
    await session.app.evaluate(() => {
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const original = fs.unlink
      fs.unlink = async target => {
        if (String(target).includes('/drafts/') && String(target).endsWith('.json')) {
          Reflect.set(globalThis, 'reloadBlocked', true)
          await new Promise<void>(resolve => { Reflect.set(globalThis, 'releaseReload', resolve) })
          fs.unlink = original
        }
        return original(target)
      }
    })
    await session.page.locator('.external-change').getByRole('button', { name: '重新载入' }).click()
    await session.page.getByRole('dialog', { name: '重新载入文件' }).getByRole('button', { name: '重新载入', exact: true }).click()
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'reloadBlocked'))).toBe(true)
    await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' LATE' } })
    })
    await expect(session.page.locator('.cm-content')).toContainText('LATE')
    await session.app.evaluate(() => (Reflect.get(globalThis, 'releaseReload') as () => void)())
    await expect(session.page.locator('.cm-content')).toContainText('disk before local LATE')
    await expect(session.page.getByRole('alert')).toContainText('已保留当前编辑')
    await expect.poll(async () => {
      const names = await readdir(folder).catch(() => [])
      return (await Promise.all(names.map(name => readFile(path.join(folder, name), 'utf8')))).some(text => text.includes('LATE'))
    }).toBe(true)
    expect(await readFile(filename, 'utf8')).toBe('disk changed')
  } finally { await stopDesktop(session) }
})

test('重新载入的迟到编辑草稿写入失败时保留真实错误并自动重试', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'reload-write-failed.md', 'disk before')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.insertText(' local')
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => (await readdir(folder).catch(() => [])).some(name => name.endsWith('.json'))).toBe(true)
    await writeFile(filename, 'disk changed')
    await expect(session.page.locator('.external-change')).toBeVisible()
    await session.app.evaluate(() => {
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const originalUnlink = fs.unlink, originalRename = fs.rename
      fs.unlink = async target => {
        if (String(target).includes('/drafts/') && String(target).endsWith('.json')) {
          Reflect.set(globalThis, 'reloadBlocked', true)
          await new Promise<void>(resolve => { Reflect.set(globalThis, 'releaseReload', resolve) })
          fs.unlink = originalUnlink
        }
        return originalUnlink(target)
      }
      Reflect.set(globalThis, 'failDraftWrites', () => {
        fs.rename = async (source, target) => {
          if (String(target).includes('/drafts/') && String(target).endsWith('.json')) throw Object.assign(new Error('injected disk full'), { code: 'ENOSPC' })
          return originalRename(source, target)
        }
      })
      Reflect.set(globalThis, 'restoreDraftWrites', () => { fs.rename = originalRename })
    })
    await session.page.locator('.external-change').getByRole('button', { name: '重新载入' }).click()
    await session.page.getByRole('dialog', { name: '重新载入文件' }).getByRole('button', { name: '重新载入', exact: true }).click()
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'reloadBlocked'))).toBe(true)
    await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' LATE' } })
    })
    await session.app.evaluate(() => { (Reflect.get(globalThis, 'failDraftWrites') as () => void)(); (Reflect.get(globalThis, 'releaseReload') as () => void)() })
    await expect(session.page.locator('.cm-content')).toContainText('disk before local LATE')
    await expect(session.page.getByRole('alert')).toContainText('磁盘空间不足')
    await session.app.evaluate(() => (Reflect.get(globalThis, 'restoreDraftWrites') as () => void)())
    await expect.poll(async () => {
      const names = (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.json'))
      return (await Promise.all(names.map(name => readFile(path.join(folder, name), 'utf8')))).some(text => text.includes('LATE'))
    }, { timeout: 8_000 }).toBe(true)
    expect(await readFile(filename, 'utf8')).toBe('disk changed')
  } finally { await stopDesktop(session) }
})

test('重新载入草稿删除失败时保留编辑和草稿，恢复后可重试', async () => {
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'reload-failed.md', 'disk before')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.insertText(' protected')
    const folder = path.join(session.userData, 'drafts')
    await expect.poll(async () => (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.json')).length).toBeGreaterThan(0)
    const draftName = (await readdir(folder)).find(name => name.endsWith('.json'))!
    const draftPath = path.join(folder, draftName), backup = draftPath + '.backup'
    await rename(draftPath, backup); await mkdir(draftPath)
    await writeFile(filename, 'disk changed')
    await expect(session.page.locator('.external-change')).toBeVisible()
    const reload = async () => {
      await session.page.locator('.external-change').getByRole('button', { name: '重新载入' }).click()
      await session.page.getByRole('dialog', { name: '重新载入文件' }).getByRole('button', { name: '重新载入', exact: true }).click()
    }
    await reload()
    await expect(session.page.getByRole('alert')).toBeVisible()
    await expect(session.page.locator('.cm-content')).toContainText('disk before protected')
    expect(JSON.parse(await readFile(backup, 'utf8')).content).toBe('disk before protected')
    expect(await readFile(filename, 'utf8')).toBe('disk changed')
    await rmdir(draftPath); await rename(backup, draftPath)
    await reload()
    await expect(session.page.locator('.cm-content')).toHaveText('disk changed')
  } finally { await stopDesktop(session) }
})
