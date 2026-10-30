import { test, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setOpenDialog, stopDesktop } from './desktop-helpers'

test('文档列表和文件树菜单明确切换视图并同步其他窗口', async () => {
  const session = await launchDesktop()
  try {
    const original = '# Original\n\nSaved content\n'
    const file = await openFixture(session, 'active.md', original)
    const nested = path.join(session.root, 'nested')
    await mkdir(nested)
    await writeFile(path.join(nested, 'inside.md'), 'nested')
    await setOpenDialog(session, [session.root])
    await session.page.getByTestId('export-menu').click()
    await session.page.getByTestId('open-folder').click()
    await expect(session.page.getByTestId('file-tree')).toBeVisible()
    const next = session.app.waitForEvent('window')
    expect((await session.page.evaluate(() => window.desktop.newWindow())).ok).toBe(true)
    const second = await next
    await second.locator('.cm-content').waitFor()
    await second.getByTestId('files-tab').click()
    await second.getByTestId('workspace-folder').click()
    await expect(second.getByTestId('file-tree')).toBeVisible()
    await clickNativeMenu(session, '文档列表')
    await expect(session.page.getByRole('list', { name: '文章列表' })).toBeVisible()
    await expect(second.getByRole('list', { name: '文章列表' })).toBeVisible()
    await expect(session.page.locator('.article-list-entry', { hasText: 'inside.md' })).toBeVisible()
    await clickNativeMenu(session, '文件树')
    await expect(session.page.getByTestId('file-tree')).toBeVisible()
    await expect(second.getByTestId('file-tree')).toBeVisible()
    if (process.platform === 'darwin') {
      await session.page.locator('.cm-content').click()
      await session.page.keyboard.press('Meta+Control+2')
      await expect(session.page.getByRole('list', { name: '文章列表' })).toBeVisible()
      const changed = await session.page.evaluate(() => window.desktop.patchPreferences({ shortcuts: { new: 'Cmd+Ctrl+2' } }))
      expect(changed.ok).toBe(true)
      const binding = await session.app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('查看'))
        const file = Menu.getApplicationMenu()?.items.find(item => item.label.startsWith('文件'))
        return { list: view?.submenu?.items.find(item => item.label === '文档列表')?.accelerator, created: file?.submenu?.items.find(item => item.label === '新建')?.accelerator }
      })
      expect(binding).toEqual({ list: null, created: 'Cmd+Ctrl+2' })
    }
    const source = await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })
    expect(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
  } finally { await stopDesktop(session) }
})
