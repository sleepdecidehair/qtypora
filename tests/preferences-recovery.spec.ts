import { test, expect } from '@playwright/test'
import { mkdir, readFile, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('偏好写入失败回滚并保留设置面板，恢复后新修改继续保存', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'preferences-recovery.md', '# Preferences\n')
    const settings = path.join(session.userData, 'settings.json')
    const original = JSON.parse(await readFile(settings, 'utf8'))
    const backup = path.join(session.userData, 'settings.before-failure.json')
    await rename(settings, backup)
    await mkdir(settings)
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByLabel('搜索设置').fill('正文字号')
    await session.page.getByLabel('正文字号', { exact: true }).fill('24')
    await session.page.getByRole('button', { name: '完成', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(session.page.getByRole('alert')).toBeVisible()
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toBeVisible()
    await expect(session.page.getByLabel('正文字号', { exact: true })).toHaveValue(String(original.preferences.fontSize))
    const state = await session.page.evaluate(() => window.desktop.bootstrap())
    expect(state.ok && state.data.preferences.fontSize).toBe(original.preferences.fontSize)
    await rmdir(settings)
    await rename(backup, settings)
    // A settled failure does not poison a later explicit flush with no pending changes.
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toHaveCount(0)
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByLabel('搜索设置').fill('正文字号')
    await session.page.getByLabel('正文字号', { exact: true }).fill('22')
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).preferences.fontSize).toBe(22)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
