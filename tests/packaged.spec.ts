import { _electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendText, openFixture, readCreatedBytes, readCreatedText, setMessageResponse, setSaveDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

const executablePath = process.env.QTYPORA_PACKAGED_EXE
test.skip(!executablePath, 'Set QTYPORA_PACKAGED_EXE to a packaged internal executable.')

test('打包后的应用显示新图标，离线读写、折叠、渲染及导出可用', async () => {
  test.setTimeout(120_000)
  const root = await mkdtemp(path.join(tmpdir(), 'qtypora-desktop-test-'))
  const userData = path.join(root, 'user-data')
  await mkdir(userData)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key.toUpperCase())) env[key] = value
  }
  env.QTYPORA_TEST_USER_DATA = userData
  const removeTemporaryRoot = async () => {
    const resolved = path.resolve(root)
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('qtypora-desktop-test-')) throw new Error('Unexpected packaged-test cleanup directory')
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  const app = await _electron.launch({ executablePath: executablePath!, args: [], env, timeout: 30_000 }).catch(async error => {
    await removeTemporaryRoot()
    throw error
  })
  let session: DesktopSession | undefined
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    const remoteRequests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
    session = { app, page, root, userData, errors, initialMode: null }
    await expect(page.locator('.cm-content')).toBeVisible()
    const logo = page.getByTestId('app-logo')
    await expect(logo).toBeVisible()
    await expect.poll(() => logo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(512)
    expect(await logo.evaluate(element => (element as HTMLImageElement).src)).toMatch(/^file:\/\/.*app\.asar\/out\/renderer\/assets\/icon-.*\.svg$/)
    const runtime = await app.evaluate(({ app, BrowserWindow, Menu, session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
      const roles = (items: Electron.MenuItem[]): string[] => items.flatMap(item => [item.role ?? '', ...roles(item.submenu?.items ?? [])])
      return { packaged: app.isPackaged, appPath: app.getAppPath(), version: app.getVersion(), windowCount: BrowserWindow.getAllWindows().length, menuRoles: roles(Menu.getApplicationMenu()?.items ?? []) }
    })
    expect(runtime.packaged).toBe(true)
    expect(runtime.appPath).toMatch(/app\.asar$/)
    expect(page.url()).toMatch(/^file:\/\/.*app\.asar\/out\/renderer\/index\.html$/)
    expect(runtime.windowCount).toBe(1)
    expect(await page.evaluate(() => ({ node: typeof Reflect.get(window, 'require'), process: typeof Reflect.get(window, 'process') }))).toEqual({ node: 'undefined', process: 'undefined' })
    expect(runtime.menuRoles).not.toContain('toggleDevTools')

    const original = '# 安装包验证\n\n## 二级标题\n\n中文正文 **粗体**。\n\n<details>\n<summary>ONB 内测分组</summary>\n\n折叠正文\n\n</details>\n\n```mermaid\ngraph LR\nA[本地文件] --> B[安装包]\n```\n\n$$\nx^2 + y^2 = 1\n$$\n\n![本地图片](./sample.png)\n\n```ts\nconst installed = true\n```\n'
    await writeFile(path.join(root, 'sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
    const file = await openFixture(session, 'installed-smoke.md', original)
    const editor = page.locator('.cm-content')
    if (await editor.getAttribute('data-mode') === 'source') await page.keyboard.press('Control+/')
    const disclosure = editor.locator('details')
    await expect(disclosure.getByText('折叠正文', { exact: true })).toBeHidden()
    await disclosure.locator('summary').click()
    await expect(disclosure.getByText('折叠正文', { exact: true })).toBeVisible()
    await disclosure.locator('summary').click()
    await editor.locator('[data-mermaid]').scrollIntoViewIfNeeded()
    await expect(editor.locator('[data-mermaid] svg')).toBeVisible({ timeout: 20_000 })
    await editor.locator('[data-math]').scrollIntoViewIfNeeded()
    await expect(editor.locator('[data-math] math')).toBeVisible({ timeout: 20_000 })
    const image = editor.getByRole('img', { name: '本地图片' })
    await image.scrollIntoViewIfNeeded()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1)
    await expect(image).toHaveAttribute('src', /^qtypora-media:\/\//)
    await editor.getByRole('combobox', { name: '代码块语言' }).scrollIntoViewIfNeeded()
    await expect(editor.getByRole('combobox', { name: '代码块语言' })).toHaveValue('ts')

    await page.keyboard.press('Control+/')
    await expect(editor).toHaveAttribute('data-mode', 'source')
    await appendText(session, '安装后的真实保存。\n')
    await page.keyboard.press('Control+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original + '安装后的真实保存。\n')
    await page.keyboard.press('Control+/')
    const html = path.join(root, 'exported.html')
    await setSaveDialog(session, html)
    await page.getByTestId('export-menu').click()
    await page.getByTestId('export-html').click()
    await expect.poll(() => readCreatedText(html), { timeout: 20_000 }).toContain('安装后的真实保存')
    const htmlText = await readFile(html, 'utf8')
    expect(htmlText).toContain('<svg')
    expect(htmlText).toContain('<math')
    expect(htmlText).toContain('data:image/png;base64,')
    const pdf = path.join(root, 'exported.pdf')
    await setSaveDialog(session, pdf)
    await page.getByTestId('export-menu').click()
    await page.getByTestId('export-pdf').click()
    await expect.poll(async () => (await readCreatedBytes(pdf)).subarray(0, 5).toString()).toBe('%PDF-')

    await setMessageResponse(session, 2)
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('未保存内容')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(editor).toBeVisible()
    expect(await readFile(file, 'utf8')).not.toContain('未保存内容')
    expect(remoteRequests).toEqual([])
    expect(errors).toEqual([])
    await page.screenshot({ path: path.join(process.env.QTYPORA_PACKAGE_LOG_DIR ?? '.debug', 'packaged-smoke.png') })
  } finally {
    if (session) await stopDesktop(session)
    else {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
      await app.close().catch(() => undefined)
      await removeTemporaryRoot()
    }
  }
})
