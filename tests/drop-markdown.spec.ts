import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { appendText, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('拖入磁盘上的 Markdown 时依次打开，原文档的草稿保留', async () => {
  const session = await launchDesktop()
  try {
    const source = 'Current document\n'
    const active = await openFixture(session, 'active.md', source)
    await appendText(session, 'unsaved draft')
    const folder = path.join(session.root, 'outside-workspace')
    await mkdir(folder)
    const first = path.join(folder, '第一份.MD')
    const second = path.join(folder, '第二份.qmd')
    const ignored = path.join(folder, 'ignored.csv')
    await writeFile(first, '# First')
    await writeFile(second, '# Second')
    await writeFile(ignored, 'ignored')
    const editor = session.page.locator('.cm-content')
    const bounds = (await editor.boundingBox())!
    const cdp = await session.page.context().newCDPSession(session.page)
    const drop = async (files: string[]) => {
      const location = { x: bounds.x + 20, y: bounds.y + 15, data: { items: [], files, dragOperationsMask: 1 } }
      await cdp.send('Input.dispatchDragEvent', { ...location, type: 'dragEnter' })
      await cdp.send('Input.dispatchDragEvent', { ...location, type: 'dragOver' })
      await cdp.send('Input.dispatchDragEvent', { ...location, type: 'drop' })
    }

    await drop([first, ignored, second])
    await expect(session.page.getByTestId('document-name')).toHaveText(path.basename(second))
    await expect(editor).toHaveText('# Second')
    await session.page.getByTestId('files-tab').click()
    const documentRow = (name: string) => session.page.locator('.open-document-row').filter({ hasText: name })
    await expect(documentRow(path.basename(first))).toHaveCount(1)
    await expect(documentRow(path.basename(ignored))).toHaveCount(0)
    await drop([first])
    await expect(session.page.getByTestId('document-name')).toHaveText(path.basename(first))
    await expect(editor).toHaveText('# First')
    await expect(documentRow(path.basename(first))).toHaveCount(1)
    const image = path.join(folder, 'dot.png')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await drop([image])
    await expect(editor).toContainText('![dot]')
    await cdp.detach()

    await documentRow('active.md').click()
    await expect(editor).toContainText('unsaved draft')
    expect(await readFile(active, 'utf8')).toBe(source)
    expect(await session.page.evaluate(() => window.desktop.openDroppedFile(new File(['fake'], 'not-a-local-file.md')))).toEqual({ ok: true, data: null })
    expect(session.errors).toEqual([])
  } finally {
    await stopDesktop(session)
  }
})
