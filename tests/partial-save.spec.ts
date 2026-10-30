import { test, expect } from '@playwright/test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop } from './desktop-helpers'

test('文件写入成功但最近文件记录失败时返回实际保存状态并允许重试', async () => {
  const session = await launchDesktop()
  try {
    const destination = path.join(session.root, 'partial-save.md')
    const canonicalDestination = path.join(await fs.realpath(session.root), 'partial-save.md')
    await session.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, destination)
    const created = await session.page.evaluate(() => window.desktop.createDocument())
    if (!created.ok) throw new Error(created.error.message)
    const settings = path.join(session.userData, 'settings.json')
    await fs.rm(settings, { force: true })
    await fs.mkdir(settings)
    const snapshot = { id: created.data.id, content: 'saved despite recent failure', revision: 1 }
    const failed = await session.page.evaluate(value => window.desktop.saveDocument(value), snapshot)
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error('Expected settings failure')
    expect(failed.document).toMatchObject({ id: snapshot.id, path: canonicalDestination, content: snapshot.content })
    expect(await fs.readFile(destination, 'utf8')).toBe(snapshot.content)
    await fs.rmdir(settings)
    const retried = await session.page.evaluate(value => window.desktop.saveDocument(value), snapshot)
    expect(retried.ok).toBe(true)
    if (retried.ok) expect(retried.data).toMatchObject({ path: canonicalDestination, content: snapshot.content })
  } finally { await stopDesktop(session) }
})
