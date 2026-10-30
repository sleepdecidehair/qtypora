import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

const exec = promisify(execFile)

test('系统未返回版本时说明结果可能无法判定', async () => {
  test.skip(process.platform !== 'darwin', '系统版本入口仅在 macOS 提供')
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'empty-system-versions.md', '# 原文\n')
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:listSystemVersions')
      ipcMain.handle('qtypora:listSystemVersions', () => ({ ok: true, data: [] }))
    })
    await clickNativeMenu(session, '系统版本历史…')
    const dialog = session.page.getByRole('dialog', { name: '系统版本历史' })
    await expect(dialog).toContainText('系统未返回历史版本；这可能表示没有版本，或系统版本服务暂不可用。')
    expect(await readFile(file, 'utf8')).toBe('# 原文\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('macOS 系统版本只读预览及文档切换后失效', async () => {
  test.skip(process.platform !== 'darwin', '系统版本仅在 macOS 提供')
  test.setTimeout(60000)
  const session = await launchDesktop()
  try {
    const current = await openFixture(session, 'system-version.md', '# 当前\n')
    const historical = path.join(session.root, 'historical.md')
    const objc = path.join(session.root, 'version-fixture.m')
    const binary = path.join(session.root, 'version-fixture')
    await writeFile(historical, '# 旧版本\n\n仅用于预览。\n')
    await writeFile(objc, `#import <Foundation/Foundation.h>
int main(int argc, const char **argv) { @autoreleasepool {
 NSURL *item=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
 NSURL *source=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[2]]];
 NSFileCoordinator *coordinator=[[NSFileCoordinator alloc] initWithFilePresenter:nil];
 __block NSError *error=nil;
 [coordinator coordinateWritingItemAtURL:item options:0 error:&error byAccessor:^(NSURL *url) {
   [NSFileVersion addVersionOfItemAtURL:url withContentsOfURL:source options:0 error:&error];
 }];
 return error ? 1 : 0;
} }`)
    await exec('/usr/bin/clang', ['-fobjc-arc', '-framework', 'Foundation', objc, '-o', binary], { timeout: 30000 })
    await exec(binary, [current, historical], { timeout: 10000 })
    await clickNativeMenu(session, '系统版本历史…')
    const dialog = session.page.getByRole('dialog', { name: '系统版本历史' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('只读预览')
    const versions = dialog.getByRole('group', { name: '可用版本' }).getByRole('button')
    await expect(versions).toHaveCount(1)
    await versions.first().click()
    await expect(dialog.getByRole('region', { name: '历史版本原文' }).locator('pre')).toHaveText('# 旧版本\n\n仅用于预览。\n')
    expect(await readFile(current, 'utf8')).toBe('# 当前\n')
    await clickNativeMenu(session, '新建')
    await expect(dialog.getByRole('alert')).toContainText('文档已变化或切换')
    await expect(dialog.getByRole('region', { name: '历史版本原文' })).toHaveCount(0)
    expect(await readFile(current, 'utf8')).toBe('# 当前\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('版本读取失败时界面失效并保留当前文档', async () => {
  test.skip(process.platform !== 'darwin', '系统版本入口仅在 macOS 提供')
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'failed-version.md', '# 当前\n')
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:listSystemVersions')
      ipcMain.removeHandler('qtypora:readSystemVersion')
      ipcMain.handle('qtypora:listSystemVersions', () => ({ ok: true, data: [{ token: 'test', modifiedAt: '2020-01-01T00:00:00Z' }] }))
      ipcMain.handle('qtypora:readSystemVersion', () => ({ ok: false, error: { code: 'CONFLICT', message: '系统版本已变化，请重新查看版本历史。' } }))
    })
    await clickNativeMenu(session, '系统版本历史…')
    const dialog = session.page.getByRole('dialog', { name: '系统版本历史' })
    await dialog.getByRole('group', { name: '可用版本' }).getByRole('button').click()
    await expect(dialog.getByRole('alert')).toHaveText('系统版本已变化，请重新查看版本历史。')
    await expect(dialog.getByRole('group', { name: '可用版本' })).toHaveCount(0)
    await expect(dialog.getByRole('region', { name: '历史版本原文' })).toHaveCount(0)
    expect(await readFile(file, 'utf8')).toBe('# 当前\n')
  } finally { await stopDesktop(session) }
})

test('切换文档后忽略迟到的历史版本响应', async () => {
  test.skip(process.platform !== 'darwin', '系统版本入口仅在 macOS 提供')
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'late-version.md', '# 当前\n')
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:listSystemVersions')
      ipcMain.removeHandler('qtypora:readSystemVersion')
      ipcMain.handle('qtypora:listSystemVersions', () => ({ ok: true, data: [{ token: 'test', modifiedAt: '2020-01-01T00:00:00Z' }] }))
      ipcMain.handle('qtypora:readSystemVersion', () => new Promise(resolve => { Reflect.set(globalThis, 'qtyporaVersionResolve', resolve) }))
    })
    await clickNativeMenu(session, '系统版本历史…')
    const dialog = session.page.getByRole('dialog', { name: '系统版本历史' })
    await dialog.getByRole('group', { name: '可用版本' }).getByRole('button').click()
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaVersionResolve'))).toBe('function')
    await clickNativeMenu(session, '新建')
    await expect(dialog.getByRole('alert')).toContainText('文档已变化或切换')
    await session.app.evaluate(() => { const resolve = Reflect.get(globalThis, 'qtyporaVersionResolve') as (value: unknown) => void; resolve({ ok: true, data: { content: '迟到版本', encoding: 'utf8' } }) })
    await expect(dialog.getByRole('region', { name: '历史版本原文' })).toHaveCount(0)
    await expect(dialog.getByRole('alert')).toContainText('文档已变化或切换')
    expect(await readFile(file, 'utf8')).toBe('# 当前\n')
  } finally { await stopDesktop(session) }
})
