/** Tracks in-flight operations that can change a document before closing. */
export class CloseCoordinator {
  private tasks = 0
  private closing = false
  private interrupted = false

  get pending(): number { return this.tasks }
  get locked(): boolean { return this.closing }
  get invalidated(): boolean { return this.interrupted }

  invalidate(): void { if (this.closing) this.interrupted = true }

  start(): (() => void) | null {
    if (this.closing) return null
    this.tasks++
    let released = false
    return () => {
      if (released) return
      released = true
      this.tasks--
    }
  }

  begin(): boolean {
    if (this.closing || this.tasks) return false
    this.interrupted = false
    this.closing = true
    return true
  }

  end(): void { this.closing = false }
}
