import { test, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appendText, launchDesktop, openFixture, setOpenDialog, setSaveDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

const editorSource = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())

test('opens, edits, saves, and saves as a .qmd document', async () => {
  const original = '# Report\n'
  const source = await openFixture(session, 'report.qmd', original)
  await appendText(session, 'Edited in QTypora')
  await session.page.keyboard.press('ControlOrMeta+s')
  const edited = '# Report\nEdited in QTypora'
  await expect.poll(async () => readFile(source, 'utf8')).toBe(edited)

  const destination = path.join(session.root, 'report-copy.qmd')
  await appendText(session, ' and saved as')
  await setSaveDialog(session, destination)
  await session.page.keyboard.press('ControlOrMeta+Shift+s')
  await expect(session.page).toHaveTitle(/report-copy\.qmd/)
  await expect.poll(async () => readFile(destination, 'utf8').catch(() => '')).toBe(`${edited} and saved as`)
  expect(await readFile(source, 'utf8')).toBe(edited)
})

test('shows .qmd files in the workspace, opens from the sidebar, quick open, and search', async () => {
  const folder = path.join(session.root, 'qmd-workspace')
  await mkdir(folder)
  await writeFile(path.join(folder, 'sidebar-target.qmd'), '# SIDEBAR_QMD_CONTENT\n')
  await writeFile(path.join(folder, 'quick-target.qmd'), '# QUICK_OPEN_QMD_CONTENT\n')
  await writeFile(path.join(folder, 'search-target.qmd'), '# SEARCH_QMD_HIT\n')
  await setOpenDialog(session, [folder])
  await session.page.getByTestId('export-menu').click()
  await session.page.getByTestId('open-folder').click()
  await session.page.getByTestId('files-tab').click()

  const tree = session.page.getByTestId('file-tree')
  const sidebarFile = tree.getByRole('treeitem', { name: 'sidebar-target.qmd', exact: true })
  await expect(sidebarFile).toBeVisible()
  await sidebarFile.click()
  await expect(session.page).toHaveTitle(/sidebar-target\.qmd/)
  await expect.poll(editorSource).toBe('# SIDEBAR_QMD_CONTENT\n')

  await session.page.keyboard.press('ControlOrMeta+p')
  const quickOpen = session.page.getByTestId('quick-open-input')
  await quickOpen.fill('quick-target')
  const quickResult = session.page.getByRole('option').filter({ hasText: 'quick-target.qmd' })
  await expect(quickResult).toHaveCount(1)
  await quickResult.press('Enter')
  await expect(session.page).toHaveTitle(/quick-target\.qmd/)
  await expect.poll(editorSource).toBe('# QUICK_OPEN_QMD_CONTENT\n')

  await session.page.getByTestId('search-tab').click()
  await session.page.getByTestId('folder-search-input').fill('SEARCH_QMD_HIT')
  const searchResult = session.page.locator('.search-result')
  await expect(searchResult).toHaveCount(1)
  await searchResult.click()
  await expect(session.page).toHaveTitle(/search-target\.qmd/)
  await expect.poll(editorSource).toBe('# SEARCH_QMD_HIT\n')
})

test('follows a cross-file link from one .qmd document to another', async () => {
  const target = path.join(session.root, 'target.qmd')
  await writeFile(target, '# TARGET_QMD_CONTENT\n')
  await openFixture(session, 'source.qmd', '# Source\n\n[Target](target.qmd)\n')
  await session.page.keyboard.press('ControlOrMeta+/')
  const link = session.page.locator('.cm-live-link[data-href="target.qmd"]')
  await expect(link).toBeVisible()
  await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await expect(session.page).toHaveTitle(/target\.qmd/)
  await expect.poll(editorSource).toBe('# TARGET_QMD_CONTENT\n')
  expect(await readFile(target, 'utf8')).toBe('# TARGET_QMD_CONTENT\n')
})
