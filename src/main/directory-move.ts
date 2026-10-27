import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { constants as osConstants } from 'node:os'
import path from 'node:path'
import { DesktopError } from './errors'
import type { FileIdentity } from './file-snapshot'

// These fixed scripts receive paths only as arguments/environment, never as code.
// Darwin exposes RENAME_EXCL through libc; the Windows API behind Directory.Move
// rejects an existing destination and refuses cross-volume directory moves.
const DARWIN_MOVE = 'ObjC.import("Foundation"); ObjC.bindFunction("renamex_np", ["int", ["char *", "char *", "unsigned int"]]); ObjC.bindFunction("__error", ["int *", []]); function run(args) { var result = $.renamex_np(args[0], args[1], 4); return JSON.stringify({result:result,errno:result===0?0:$.__error()[0]}); }'
const WINDOWS_MOVE = '$ErrorActionPreference="Stop"; try { [System.IO.Directory]::Move($env:QTYPORA_MOVE_SOURCE,$env:QTYPORA_MOVE_DESTINATION); [Console]::Out.Write("0") } catch { $e=$_.Exception; while ($e.InnerException) { $e=$e.InnerException }; [Console]::Out.Write([string]$e.HResult); exit 1 }'
const sameIdentity = (a: FileIdentity, b: FileIdentity): boolean => a.dev === b.dev && a.ino === b.ino

interface NativeResult { status: number; output: string; startFailure: boolean; timedOut: boolean }

function runNative(source: string, destination: string): Promise<NativeResult> {
  let executable: string
  let args: string[]
  let env = process.env
  if (process.platform === 'darwin') {
    executable = '/usr/bin/osascript'
    args = ['-l', 'JavaScript', '-e', DARWIN_MOVE, source, destination]
  } else if (process.platform === 'win32') {
    const root = process.env.SystemRoot
    if (!root || !path.win32.isAbsolute(root)) return Promise.resolve({ status: -1, output: '', startFailure: true, timedOut: false })
    // .NET's Directory.Move trims trailing spaces; reject these paths rather than changing their meaning.
    if ([source, destination].some(item => item.split(/[\\/]/).some(part => /[. ]$/.test(part)))) throw new DesktopError('UNSUPPORTED', 'Windows 目录路径包含结尾空格或句点，不能安全移动。')
    executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_MOVE]
    env = { ...process.env, QTYPORA_MOVE_SOURCE: source, QTYPORA_MOVE_DESTINATION: destination }
  } else return Promise.resolve({ status: -1, output: '', startFailure: true, timedOut: false })

  return new Promise(resolve => {
    // execFile uses no shell and invokes the callback after the child has closed.
    execFile(executable, args, { env, shell: false, windowsHide: true, timeout: 10000, maxBuffer: 16384, encoding: 'utf8' }, (error, stdout) => {
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
      resolve({ status: failure ? 1 : 0, output: stdout.trim(), startFailure: failure?.code === 'ENOENT' || failure?.code === 'EACCES', timedOut: Boolean(failure?.killed) })
    })
  })
}

function nativeFailure(result: NativeResult): DesktopError | null {
  if (result.startFailure) return new DesktopError('UNSUPPORTED', '此系统缺少安全目录移动所需的原生工具。')
  if (result.timedOut) return new DesktopError('IO_ERROR', '目录移动程序超时，请检查原位置和目标位置。')
  if (process.platform === 'darwin') {
    let data: unknown
    try { data = JSON.parse(result.output) as unknown } catch { return new DesktopError('IO_ERROR', '目录移动程序返回无效结果，请检查原位置和目标位置。') }
    if (!data || typeof data !== 'object' || !('result' in data) || !('errno' in data) || typeof data.result !== 'number' || typeof data.errno !== 'number') return new DesktopError('IO_ERROR', '目录移动程序返回无效结果，请检查原位置和目标位置。')
    if (data.result === 0 && result.status === 0) return null
    if (data.errno === osConstants.errno.EEXIST || data.errno === osConstants.errno.ENOTEMPTY) return new DesktopError('CONFLICT', '目标名称已经存在，未覆盖。')
    if (data.errno === osConstants.errno.EXDEV) return new DesktopError('UNSUPPORTED', '不支持跨文件系统移动目录。')
    if (data.errno === osConstants.errno.EACCES || data.errno === osConstants.errno.EPERM) return new DesktopError('PERMISSION_DENIED', '没有目录移动所需的权限。')
    if (data.errno === osConstants.errno.ENOENT) return new DesktopError('NOT_FOUND', '源目录或目标文件夹不存在。')
  } else if (process.platform === 'win32') {
    if (result.status === 0 && result.output === '0') return null
    const code = Number(result.output) & 0xffff
    if (code === 80 || code === 183) return new DesktopError('CONFLICT', '目标名称已经存在，未覆盖。')
    if (code === 17) return new DesktopError('UNSUPPORTED', '不支持跨文件系统移动目录。')
    if (code === 5 || code === 32) return new DesktopError('PERMISSION_DENIED', '没有目录移动所需的权限，或目录正被占用。')
    if (code === 2 || code === 3) return new DesktopError('NOT_FOUND', '源目录或目标文件夹不存在。')
  }
  return new DesktopError('IO_ERROR', '目录移动失败，请检查路径和磁盘状态。')
}

async function statOrNull(filePath: string): Promise<Stats | null> {
  try { return await fs.lstat(filePath) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/** Moves one directory atomically without replacing a destination, preserving all child bytes. */
export async function moveDirectoryExclusive(source: string, destination: string, expected?: FileIdentity): Promise<FileIdentity> {
  const before = await fs.lstat(source)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new DesktopError('UNSUPPORTED', '只能移动普通目录，不能移动符号链接。')
  if (expected && !sameIdentity(before, expected)) throw new DesktopError('CONFLICT', '源目录已被替换，请重新操作。')
  const parent = await fs.stat(path.dirname(destination))
  if (!parent.isDirectory()) throw new DesktopError('INVALID_INPUT', '目标必须是文件夹。')
  if (before.dev !== parent.dev) throw new DesktopError('UNSUPPORTED', '不支持跨文件系统移动目录。')
  const result = await runNative(source, destination)
  const failure = nativeFailure(result)
  const [afterSource, afterDestination] = await Promise.all([statOrNull(source), statOrNull(destination)])
  // A timeout or tool failure is not automatically a failure if the kernel already completed the rename.
  if (!afterSource && afterDestination?.isDirectory() && !afterDestination.isSymbolicLink() && sameIdentity(before, afterDestination)) return { dev: before.dev, ino: before.ino }
  if (failure) throw failure
  if (!afterSource && afterDestination && !sameIdentity(before, afterDestination)) {
    // An external writer replaced the source before the syscall. Move that replacement back
    // only with the same exclusive primitive; never overwrite a concurrently recreated source.
    const rollback = await runNative(destination, source)
    if (!nativeFailure(rollback)) throw new DesktopError('CONFLICT', '源目录在移动期间被替换，替换内容已退回原位置。')
    throw new DesktopError('CONFLICT', '源目录在移动期间被替换，无法安全退回；请检查原位置和目标位置。')
  }
  throw new DesktopError('CONFLICT', '目录移动结果已被外部更改，请检查原位置和目标位置。')
}
