import { test, expect } from '@playwright/test'
import { launchDesktop, stopDesktop } from './desktop-helpers'

test('两个窗口的剪贴板 API 写入按主进程接收顺序完成', async () => {
  const session = await launchDesktop()
  try {
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await opening
    await expect(second.locator('.cm-content')).toBeVisible()
    await session.app.evaluate(({ clipboard }) => {
      const global = globalThis as typeof globalThis & { clipboardGate?: { entered: string[]; release: () => void; restore: () => void } }
      const original = clipboard.write.bind(clipboard)
      let release = () => {}
      const gate = new Promise<void>(resolve => { release = resolve })
      const state = { entered: [] as string[], release, restore: () => { clipboard.write = original } }
      global.clipboardGate = state
      clipboard.write = async items => { const text = await items[0].getType('text/plain').then(value => value.text()); state.entered.push(text); if (text === 'first') await gate; return original(items) }
    })
    await session.page.evaluate(() => { void window.desktop.writeClipboard({ text: 'first', html: '<b>first</b>' }) })
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { entered: string[] } }).clipboardGate?.entered)).toEqual(['first'])
    await second.evaluate(() => { void window.desktop.writeClipboard({ text: 'second', html: '<b>second</b>' }) })
    await second.waitForTimeout(150)
    expect(await session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { entered: string[] } }).clipboardGate?.entered)).toEqual(['first'])
    await session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { release: () => void } }).clipboardGate?.release())
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { entered: string[] } }).clipboardGate?.entered)).toEqual(['first', 'second'])
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('second')
    expect(await session.app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(value => value.types.includes('text/html'))
      return item ? (await item.getType('text/html')).text() : ''
    })).toContain('<b>second</b>')
  } finally {
    await session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { release: () => void; restore: () => void } }).clipboardGate?.release()).catch(() => {})
    await session.app.evaluate(() => (globalThis as typeof globalThis & { clipboardGate?: { restore: () => void } }).clipboardGate?.restore()).catch(() => {})
    await stopDesktop(session)
  }
})
