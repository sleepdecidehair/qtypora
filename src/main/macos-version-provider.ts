import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DesktopError } from './errors'
import type { NativeVersionEntry, NativeVersionProvider } from './system-version-history'

// Fixed script: file paths are passed as argv, never interpolated into source or a shell.
const SCRIPT = `ObjC.import('Foundation');
function run(argv) {
  var versions = $.NSFileVersion.otherVersionsOfItemAtURL($.NSURL.fileURLWithPath(argv[0]));
  if (versions.isNil()) return '[]';
  if (Number(versions.count) > 500) throw new Error('Too many versions');
  var result = [];
  for (var i = 0; i < Number(versions.count); i++) {
    var version = versions.objectAtIndex(i);
    result.push({ identifier: ObjC.unwrap(version.persistentIdentifier.description),
      path: ObjC.unwrap(version.URL.path),
      modifiedAt: new Date(Number(version.modificationDate.timeIntervalSince1970) * 1000).toISOString() });
  }
  return JSON.stringify(result);
}`

const runFile = promisify(execFile)

/** macOS-only read-only Foundation enumeration; no shell, writes, or restore calls. */
export class MacOSVersionProvider implements NativeVersionProvider {
  async list(filePath: string): Promise<NativeVersionEntry[]> {
    if (process.platform !== 'darwin') throw new DesktopError('UNSUPPORTED', '系统版本历史仅在 macOS 可用。')
    try {
      const { stdout } = await runFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, filePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true })
      const result: unknown = JSON.parse(stdout)
      if (!Array.isArray(result)) throw new Error('Invalid result')
      return result as NativeVersionEntry[]
    } catch (error) {
      if (error instanceof DesktopError) throw error
      throw new DesktopError('IO_ERROR', '无法读取系统版本历史。')
    }
  }
}
