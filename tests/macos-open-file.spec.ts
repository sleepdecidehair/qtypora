import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, stopDesktop, type DesktopSession } from './desktop-helpers'

test.skip(process.platform !== 'darwin', 'macOS open-file events are only emitted on macOS.')

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

test('Finder open-file events reuse the current window without duplicating the document', async () => {
  const file = path.join(session.root, 'finder-open.md')
  await writeFile(file, '# Finder 打开\n', 'utf8')
  const emit = () => session.app.evaluate(({ app }, filePath) => {
    let prevented = false
    app.emit('open-file', { preventDefault: () => { prevented = true } } as Electron.Event, filePath)
    return prevented
  }, file)

  expect(await emit()).toBe(true)
  await expect(session.page).toHaveTitle(/finder-open\.md/)
  await session.page.getByTestId('files-tab').click()
  await expect(session.page.locator('.open-document-row', { hasText: 'finder-open.md' })).toHaveCount(1)

  expect(await emit()).toBe(true)
  await expect(session.page.locator('.open-document-row', { hasText: 'finder-open.md' })).toHaveCount(1)
})
