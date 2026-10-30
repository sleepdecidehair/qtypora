import { randomUUID } from 'node:crypto'
import type { DocumentSnapshot } from '../shared/contracts'

/** A window-scoped, single-use handshake. Missing or late responses fail closed. */
export class CloseValidation {
  private pending: { id: string; finish: (valid: boolean) => void } | null = null
  private disposed = false

  constructor(private readonly send: (id: string, snapshots: DocumentSnapshot[]) => void, private readonly timeoutMs = 30_000) {}

  async request(snapshots: DocumentSnapshot[]): Promise<boolean> {
    if (this.disposed || this.pending) return false
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), this.timeoutMs)
      const finish = (valid: boolean): void => {
        if (this.pending?.id !== id) return
        clearTimeout(timer)
        this.pending = null
        resolve(valid)
      }
      this.pending = { id, finish }
      try { this.send(id, snapshots) } catch { finish(false) }
    })
  }

  resolve(id: string, valid: boolean): void {
    if (this.pending?.id === id) this.pending.finish(valid)
  }

  dispose(): void {
    this.disposed = true
    this.pending?.finish(false)
  }
}
