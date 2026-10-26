import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop, openFixture, setSaveDialog, clickNativeMenu, appendText, setOpenDialog } from './desktop-helpers'

test('跨窗口偏好逐字段合并并同步，快捷键改动与禁用不会保留旧绑定', async () => {
  const session = await launchDesktop()
  try {
    const source = await openFixture(session, 'shortcuts.md', '# Original\n')
    const otherWindow = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await otherWindow
    await second.locator('.cm-content').waitFor()
    const firstChange = await session.page.evaluate(() => window.desktop.patchPreferences({ export: { marginMm: 25 }, markdown: { mathNumbering: true } }))
    expect(firstChange.ok).toBe(true)
    const secondChange = await second.evaluate(() => window.desktop.patchPreferences({ export: { pageSize: 'Letter' }, fontSize: 19 }))
    expect(secondChange.ok).toBe(true)
    const state = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(state.ok && state.data.preferences).toMatchObject({ export: { marginMm: 25, pageSize: 'Letter' }, markdown: { mathNumbering: true }, fontSize: 19 })
    await expect.poll(() => session.page.locator('.cm-editor').evaluate(node => getComputedStyle(node).fontSize)).toBe('19px')
    if (process.env.QTYPORA_TEST_VISIBLE === '1') {
      const nativeWindow = await session.app.browserWindow(session.page)
      await nativeWindow.evaluate(window => { window.show(); window.focus() })
      await expect.poll(() => nativeWindow.evaluate(window => window.isFocused())).toBe(true)
      await session.page.bringToFront()
    }
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByLabel('搜索设置').fill('保存')
    await session.page.getByLabel('保存快捷键', { exact: true }).fill('CmdOrCtrl+Alt+S')
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(async () => { const result = await session.page.evaluate(() => window.desktop.bootstrap()); return result.ok ? result.data.preferences.shortcuts.save : null }).toBe('CmdOrCtrl+Alt+S')
    await appendText(session, '\nchanged')
    await session.page.keyboard.press('ControlOrMeta+s')
    expect(await readFile(source, 'utf8')).toBe('# Original\n')
    await session.page.keyboard.press('ControlOrMeta+Alt+s')
    await expect.poll(() => readFile(source, 'utf8')).toContain('changed')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('Markdown 自定义导出与复用配置不依赖图表渲染，原文和跨窗口源文件受保护', async () => {
  const session = await launchDesktop()
  try {
    const content = '# 原文\n\n```mermaid\ninvalid broken graph\n```\n'
    const source = await openFixture(session, 'custom.md', content)
    await expect.poll(async () => (await session.page.locator('.cm-line').allTextContents()).join('\n')).toBe(content)
    const converter = path.join(session.root, 'copy.cjs')
    await writeFile(converter, "require('node:fs').copyFileSync(process.argv[2],process.argv[3])")
    const result = await session.page.evaluate(({ executable, converter }) => window.desktop.patchPreferences({ export: { customPreset: '原文副本', customPresets: [{ name: '原文副本', extension: 'md', executable, args: [converter, '{input}', '{output}'], input: 'markdown', template: '' }] } }), { executable: process.execPath, converter })
    expect(result.ok).toBe(true)
    const destination = path.join(session.root, 'custom-export.md')
    await setSaveDialog(session, destination)
    await clickNativeMenu(session, '更多导出格式与设置…')
    await session.page.getByLabel('导出格式', { exact: true }).selectOption('custom')
    await session.page.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(async () => { try { return await readFile(destination, 'utf8') } catch { return '' } }).toBe(content)
    await session.page.getByLabel('关闭导出文档').click()
    const again = path.join(session.root, 'again.md')
    await setSaveDialog(session, again)
    await clickNativeMenu(session, '使用上次导出设置…')
    await expect.poll(async () => { try { return await readFile(again, 'utf8') } catch { return '' } }).toBe(content)
    const protectedFile = path.join(session.root, 'other-window.md')
    await writeFile(protectedFile, '# Other window')
    const other = session.app.waitForEvent('window')
    await session.page.evaluate(path => window.desktop.newWindow(path), protectedFile)
    await (await other).locator('.cm-content').waitFor()
    if (process.env.QTYPORA_TEST_VISIBLE === '1') {
      const nativeWindow = await session.app.browserWindow(session.page)
      await nativeWindow.evaluate(window => { window.show(); window.focus() })
      await expect.poll(() => nativeWindow.evaluate(window => window.isFocused())).toBe(true)
      await session.page.bringToFront()
    }
    await setSaveDialog(session, protectedFile)
    await clickNativeMenu(session, '使用上次导出设置…')
    await expect(session.page.getByRole('alert')).toContainText('源文档')
    expect(await readFile(source, 'utf8')).toBe(content)
    expect(await readFile(protectedFile, 'utf8')).toBe('# Other window')
  } finally { await stopDesktop(session) }
})

test('Pandoc 导入带图Word保留图片与未保存草稿，用户可保存为Markdown', async () => {
  const executable = process.env.QTYPORA_TEST_PANDOC
  test.skip(!executable, '需要设置 QTYPORA_TEST_PANDOC 才运行真实外部转换器验证')
  const session = await launchDesktop()
  try {
    await session.page.evaluate(path => window.desktop.patchPreferences({ export: { pandocPath: path } }), executable!)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVj8AAAAASUVORK5CYII='
    const source = await openFixture(session, 'pandoc-source.md', `# Word Roundtrip\n\n**文本**\n\n![pixel](${png})\n`)
    const output = path.join(session.root, 'roundtrip.docx')
    const htmlOutput = path.join(session.root, 'roundtrip.html')
    await setSaveDialog(session, htmlOutput)
    await clickNativeMenu(session, '更多导出格式与设置…')
    await session.page.getByLabel('导出格式', { exact: true }).selectOption('html')
    await session.page.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(async () => { try { return await readFile(htmlOutput, 'utf8') } catch { return '' } }).toContain('Word Roundtrip')
    expect(await readFile(htmlOutput, 'utf8')).toContain(`src="${png}"`)
    await setSaveDialog(session, output)
    await session.page.getByLabel('导出格式', { exact: true }).selectOption('docx')
    await session.page.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(async () => { try { return (await readFile(output)).subarray(0, 2).toString() } catch { return '' } }).toBe('PK')
    await session.page.getByLabel('关闭导出文档').click()
    await setOpenDialog(session, [output])
    await clickNativeMenu(session, '导入文档…')
    await expect(session.page.getByTestId('document-name')).toContainText('未命名')
    await expect(session.page.getByTestId('dirty-indicator')).toBeVisible()
    await expect.poll(async () => { const state = await session.page.evaluate(() => window.desktop.bootstrap()); return state.ok && state.data.documents.some(doc => doc.unsaved && doc.content.includes('Word Roundtrip')) }).toBe(true)
    await session.page.keyboard.press('ControlOrMeta+/')
    await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
    await expect.poll(() => session.page.locator('.cm-content img[src]').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1)
    const saved = path.join(session.root, 'imported.md')
    await setSaveDialog(session, saved)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(async () => { try { return await readFile(saved, 'utf8') } catch { return '' } }).toContain('Word Roundtrip')
    expect(await readFile(source, 'utf8')).toContain('**文本**')
  } finally { await stopDesktop(session) }
})

test('生成内容期间设置发生变化时拒绝混用不同导出配置', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'config-race.md', '# Stable source')
    const plan = await session.page.evaluate(async () => {
      const state = await window.desktop.bootstrap()
      if (!state.ok) throw new Error(state.error.message)
      const record = state.data.documents.find(item => item.name === 'config-race.md')!
      const plan = await window.desktop.getExportPlan({ id: record.id, kind: 'pdf' })
      if (!plan.ok) throw new Error(plan.error.message)
      return { id: record.id, preferencesVersion: plan.data.preferencesVersion }
    })
    const destination = path.join(session.root, 'protected.pdf')
    await writeFile(destination, 'existing-pdf')
    await setSaveDialog(session, destination)
    await session.page.evaluate(() => window.desktop.patchPreferences({ export: { pageSize: 'Letter' } }))
    const result = await session.page.evaluate(plan => window.desktop.exportDocument({ ...plan, kind: 'pdf', html: '<p>Content using previous settings</p>' }), plan)
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readFile(destination, 'utf8')).toBe('existing-pdf')
  } finally { await stopDesktop(session) }
})

test('固定目录只能保留已授权位置，偏好变更不能扩大文件访问范围', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'authorized.md', '# Authorized')
    const result = await session.page.evaluate(folder => window.desktop.patchPreferences({ workspace: { pinnedFolders: [folder] } }), path.dirname(session.root))
    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    const state = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(state.ok && state.data.preferences.workspace.pinnedFolders).toEqual([])
    const authorized = await session.page.evaluate(folder => window.desktop.patchPreferences({ workspace: { pinnedFolders: [folder] } }), session.root)
    expect(authorized.ok).toBe(true)
  } finally { await stopDesktop(session) }
})
