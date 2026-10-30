import { test, expect } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('编码后超限的 CRLF 保存保留原文件和可恢复草稿', async () => {
  const session = await launchDesktop()
  try {
    const original = '\ufefforiginal\r\n'
    const filename = await openFixture(session, 'encoded-size.md', original)
    const result = await session.page.evaluate(async () => {
      const bootstrap = await window.desktop.bootstrap()
      if (!bootstrap.ok) throw new Error(bootstrap.error.message)
      const document = bootstrap.data.documents.find(item => item.name === 'encoded-size.md')
      if (!document) throw new Error('fixture document missing')
      return window.desktop.saveDocument({ id: document.id, content: '\n'.repeat(8 * 1024 * 1024 + 1), revision: 1 })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED')
    expect(await readFile(filename, 'utf8')).toBe(original)
    const folder = path.join(session.userData, 'drafts')
    const drafts = (await readdir(folder)).filter(name => name.endsWith('.json'))
    expect(drafts).toHaveLength(1)
    const draft = JSON.parse(await readFile(path.join(folder, drafts[0]), 'utf8')) as { content: string }
    expect(draft.content.length).toBe(8 * 1024 * 1024 + 1)
  } finally { await stopDesktop(session) }
})
