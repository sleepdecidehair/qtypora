import { spawn } from 'node:child_process'
import path from 'node:path'
import { DesktopError } from './errors'

interface ConverterOptions {
  label: string
  input?: Uint8Array
  cwd?: string
  collectOutput?: boolean
  timeoutMs?: number
  outputLimit?: number
  logLimit?: number
  startError?: string
}

/** A failed conversion settles only after close, so callers can safely clean staging files. */
export function runConverter(executable: string, args: string[], options: ConverterOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, cwd: options.cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const timeoutMs = options.timeoutMs ?? 60_000
    const outputLimit = options.outputLimit ?? 64 * 1024 * 1024
    const logLimit = options.logLimit ?? 1024 * 1024
    let outputBytes = 0, logBytes = 0
    let stderr = ''
    let failure: DesktopError | undefined
    let closed = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let windowsKiller: ReturnType<typeof spawn> | undefined
    const stopTree = (signal: NodeJS.Signals) => {
      if (!child.pid || closed) return
      if (process.platform === 'win32') {
        if (windowsKiller) return
        // /T also terminates the converter's children; killing its parent first would orphan them.
        const systemRoot = process.env.SystemRoot || 'C:\\Windows'
        windowsKiller = spawn(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
        const fallback = () => { if (!closed) child.kill('SIGKILL') }
        windowsKiller.once('error', fallback)
        windowsKiller.once('close', code => { if (code !== 0) fallback() })
        return
      }
      try { process.kill(-child.pid, signal) }
      catch { if (child.exitCode === null && child.signalCode === null) child.kill(signal) }
    }
    const cancel = (error: DesktopError) => {
      if (closed || failure) return
      failure = error
      child.stdin.destroy()
      stopTree('SIGTERM')
      forceTimer = setTimeout(() => {
        if (process.platform === 'win32') { if (!closed) child.kill('SIGKILL') }
        else stopTree('SIGKILL')
      }, process.platform === 'win32' ? 2000 : 300)
    }
    const timer = setTimeout(() => cancel(new DesktopError('IO_ERROR', `${options.label}超过 ${Math.ceil(timeoutMs / 1000)} 秒，已取消本次转换。`)), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return
      if (options.collectOutput === false) logBytes += chunk.length
      else outputBytes += chunk.length
      if (outputBytes > outputLimit || logBytes > logLimit) cancel(new DesktopError('UNSUPPORTED', `${options.label}的输出或日志超过大小限制。`))
      else if (options.collectOutput !== false) chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (failure) return
      logBytes += chunk.length
      if (logBytes > logLimit) { cancel(new DesktopError('UNSUPPORTED', `${options.label}的日志超过大小限制。`)); return }
      if (stderr.length < 4000) stderr += chunk.toString('utf8').slice(0, 4000 - stderr.length)
    })
    child.once('error', () => cancel(new DesktopError('NOT_FOUND', options.startError ?? `无法启动${options.label}程序，请检查配置。`)))
    child.once('close', code => {
      closed = true
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      if (failure) reject(failure)
      else if (code !== 0) reject(new DesktopError('IO_ERROR', `${options.label}失败：${stderr.trim().slice(0, 1200) || `退出码 ${code}`}`))
      else resolve(Buffer.concat(chunks))
    })
    // Early converter failure can close stdin before all input is consumed; close handles its result.
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input)
  })
}
