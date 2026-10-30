import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { hashBytes } from './files'
import { MacOSVersionProvider } from './macos-version-provider'
import { SystemVersionHistory } from './system-version-history'

const exec = promisify(execFile)

it.skipIf(process.platform !== 'darwin')('reads a real isolated Foundation version without changing the current file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-native-version-'))
  try {
    const current = path.join(directory, 'current.md'), previous = path.join(directory, 'previous.md')
    const source = path.join(directory, 'create.m'), binary = path.join(directory, 'create')
    const saved = Buffer.from('current\n'), historical = Buffer.from('\ufeffold\r\nline\n')
    await fs.writeFile(current, saved)
    await fs.writeFile(previous, historical)
    await fs.writeFile(source, `#import <Foundation/Foundation.h>
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
    await exec(binary, [current, previous], { timeout: 10_000 })
    const stat = await fs.stat(current)
    const context = { id: 'doc', path: current, version: hashBytes(saved), revision: 1, content: 'independent draft', fileMissing: false, identity: { dev: stat.dev, ino: stat.ino } }
    const service = new SystemVersionHistory(() => context, new MacOSVersionProvider())
    const versions = await service.list('doc')
    expect(versions).toHaveLength(1)
    expect(await service.read('doc', versions[0].token)).toEqual(historical)
    expect(await fs.readFile(current)).toEqual(saved)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}, 60_000)
