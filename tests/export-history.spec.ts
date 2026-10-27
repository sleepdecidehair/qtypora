import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop, openFixture, setOpenDialog, setSaveDialog, clickNativeMenu } from './desktop-helpers'

test('成功导出的格式与设置跨重启可复用，记录不包含执行程序且不覆盖源文档', async () => {
  let session = await launchDesktop()
  try {
    const source = await openFixture(session, 'history.md', '# Keep source\n')
    const originalOutput = path.join(session.root, 'first.html')
    await setSaveDialog(session, originalOutput)
    await clickNativeMenu(session, '更多导出格式与设置…')
    await session.page.getByLabel('导出格式', { exact: true }).selectOption('html')
    await session.page.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(async () => { try { return await readFile(originalOutput, 'utf8') } catch { return '' } }).toContain('Keep source')
    const historyFile = path.join(session.userData, 'export-history.json')
    await expect.poll(async () => { try { return await readFile(historyFile, 'utf8') } catch { return '' } }).toContain('first.html')
    const history = await readFile(historyFile, 'utf8')
    expect(history).not.toMatch(/executable|pandocPath|customPresets|Keep source/)
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+o')
    await expect(session.page.getByTestId('document-name')).toHaveText('history.md')
    const next = path.join(root, 'after-restart.html')
    await setSaveDialog(session, next)
    await clickNativeMenu(session, '使用上次导出设置…')
    await expect.poll(async () => { try { return await readFile(next, 'utf8') } catch { return '' } }).toContain('Keep source')
    expect(await readFile(source, 'utf8')).toBe('# Keep source\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('渲染期间上次导出记录改变时拒绝混用旧内容', async () => {
  const session = await launchDesktop()
  try {
    const source = await openFixture(session, 'history-race.md', '# Stable\n')
    const output = path.join(session.root, 'first.md')
    await setSaveDialog(session, output)
    const id = await session.page.evaluate(async () => {
      const state = await window.desktop.bootstrap()
      if (!state.ok) throw new Error(state.error.message)
      return state.data.documents.find(item => item.name === 'history-race.md')!.id
    })
    expect((await session.page.evaluate(id => window.desktop.exportDocument({ id, kind: 'markdown' }), id)).ok).toBe(true)
    const plan = await session.page.evaluate(async id => {
      const result = await window.desktop.getExportPlan({ id, kind: 'html', reusePrevious: true })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, id)
    const newer = path.join(session.root, 'newer.md')
    await setSaveDialog(session, newer)
    expect((await session.page.evaluate(id => window.desktop.exportDocument({ id, kind: 'markdown' }), id)).ok).toBe(true)
    const result = await session.page.evaluate(({ id, plan }) => window.desktop.exportDocument({ id, kind: 'html', reusePrevious: true, preferencesVersion: plan.preferencesVersion, historyVersion: plan.historyVersion }), { id, plan })
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readFile(source, 'utf8')).toBe('# Stable\n')
  } finally { await stopDesktop(session) }
})

test('历史文件被外部改动时提示文件已导出并保留外部内容', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'history-conflict.md', '# Stable\n')
    const external = path.join(session.userData, 'export-history.json')
    await writeFile(external, 'external change')
    const output = path.join(session.root, 'still-exported.md')
    await setSaveDialog(session, output)
    const result = await session.page.evaluate(async () => {
      const state = await window.desktop.bootstrap()
      if (!state.ok) throw new Error(state.error.message)
      const record = state.data.documents.find(item => item.name === 'history-conflict.md')!
      return window.desktop.exportDocument({ id: record.id, kind: 'markdown' })
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'IO_ERROR', message: expect.stringContaining('文件已导出') } })
    expect(await readFile(output, 'utf8')).toBe('# Stable\n')
    expect(await readFile(external, 'utf8')).toBe('external change')
  } finally { await stopDesktop(session) }
})
