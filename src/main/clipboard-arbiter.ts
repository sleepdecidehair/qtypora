import { DesktopError } from './errors'

type Pending = { owner: number; start: () => void; reject: (error: Error) => void }
const MAX_PENDING = 128

/** Serializes cooperating clipboard API writers in main-process arrival order. */
export class ClipboardArbiter {
  private pending: Pending[] = []
  private active = false
  private terminated = new Set<number>()

  private drain(): void {
    if (this.active) return
    this.pending.shift()?.start()
  }

  run<T>(owner: number, write: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!Number.isSafeInteger(owner) || owner <= 0 || this.terminated.has(owner)) { reject(new DesktopError('PERMISSION_DENIED', '剪贴板操作窗口已失效。')); return }
      if (this.pending.length >= MAX_PENDING) { reject(new DesktopError('CONFLICT', '剪贴板操作过多，请稍后重试。')); return }
      this.pending.push({ owner, reject, start: () => {
        this.active = true
        void Promise.resolve().then(write).then(resolve, reject).finally(() => { this.active = false; this.drain() })
      } })
      this.drain()
    })
  }

  /** Cancel waiting work; in-flight system writes must finish before the queue continues. */
  ownerTerminated(owner: number): void {
    this.terminated.add(owner)
    const rejected = this.pending.filter(entry => entry.owner === owner)
    this.pending = this.pending.filter(entry => entry.owner !== owner)
    for (const entry of rejected) entry.reject(new DesktopError('PERMISSION_DENIED', '剪贴板操作窗口已关闭。'))
  }

  /** A newly loaded, trusted main frame may reuse the webContents owner id. */
  ownerActive(owner: number): void { this.terminated.delete(owner) }
}
