import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

const exec = promisify(execFile)

test('系统历史只读 IPC 保留草稿并拒绝相同字节的外部替换', async () => {
  test.skip(process.platform !== 'darwin', '系统版本服务仅适用于 macOS')
  const session = await launchDesktop()
  try {
    const filename = await openFixture(session, 'history-ipc.md', 'disk\n')
    const previous = path.join(session.root, 'version-source.md')
    const source = path.join(session.root, 'create-version.m')
    const binary = path.join(session.root, 'create-version')
    await writeFile(previous, Buffer.from('\ufeffold\r\nline\n'))
    await writeFile(source, `#import <Foundation/Foundation.h>
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
    await exec('/usr/bin/clang', ['-fobjc-arc', '-framework', 'Foundation', source, '-o', binary], { timeout: 30_000 })
    await exec(binary, [filename, previous], { timeout: 10_000 })
    const result = await session.page.evaluate(() => window.desktop.bootstrap())
    if (!result.ok) throw new Error(result.error.message)
    const document = result.data.documents.find(item => item.name === 'history-ipc.md')
    if (!document) throw new Error('missing test document')
    const editor = session.page.locator('.cm-content')
    await editor.click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.insertText('draft')
    const snapshot = { id: document.id, content: 'disk\ndraft', revision: 1 }
    const versions = await session.page.evaluate(snapshot => window.desktop.listSystemVersions(snapshot), snapshot)
    if (!versions.ok) throw new Error(versions.error.message)
    expect(versions.data).toHaveLength(1)
    expect(JSON.stringify(versions.data)).not.toContain(session.root)
    const request = { snapshot, token: versions.data[0].token }
    const preview = await session.page.evaluate(request => window.desktop.readSystemVersion(request), request)
    expect(preview).toEqual({ ok: true, data: { content: 'old\r\nline\n', encoding: 'utf8-bom' } })
    expect(await readFile(filename, 'utf8')).toBe('disk\n')
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(path.join(session.userData, 'drafts', `${document.id}.json`), 'utf8')).content } catch { return null }
    }).toBe('disk\ndraft')
    const replacement = path.join(session.root, 'replacement.md')
    await writeFile(replacement, 'disk\n')
    await rename(replacement, filename)
    const stale = await session.page.evaluate(request => window.desktop.readSystemVersion(request), request)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('CONFLICT')
    expect(await readFile(filename, 'utf8')).toBe('disk\n')
  } finally { await stopDesktop(session) }
})
