import path from 'node:path'

interface PendingFile {
  filePath: string
  key: string
  resolve: () => void
}

export class OpenFileQueue {
  private readonly pending: PendingFile[] = []
  private readonly scheduled = new Map<string, Promise<void>>()
  private started = false
  private drainTask: Promise<void> | null = null

  constructor(private readonly open: (filePath: string) => Promise<void>, private readonly onError: (error: unknown) => void) {}

  enqueue(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const existing = this.scheduled.get(key)
    if (existing) return existing
    let resolve: () => void = () => undefined
    const completion = new Promise<void>(done => { resolve = done })
    this.scheduled.set(key, completion)
    this.pending.push({ filePath: resolved, key, resolve })
    if (this.started) void this.drain()
    return completion
  }

  start(): Promise<void> {
    this.started = true
    return this.drain()
  }

  private drain(): Promise<void> {
    if (this.drainTask) return this.drainTask
    this.drainTask = (async () => {
      while (this.pending.length) {
        const next = this.pending.shift()!
        try { await this.open(next.filePath) }
        catch (error) { this.onError(error) }
        finally {
          this.scheduled.delete(next.key)
          next.resolve()
        }
      }
    })().finally(() => {
      this.drainTask = null
      if (this.started && this.pending.length) void this.drain()
    })
    return this.drainTask
  }
}
