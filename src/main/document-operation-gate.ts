import { DesktopError } from './errors'

/** Reserve a document before any asynchronous workspace lock or dialog. */
export class DocumentOperationGate {
  private readonly busy = new Set<string>()

  begin(id: string): () => void {
    if (this.busy.has(id)) throw new DesktopError('CONFLICT', '文档正在保存或重新载入，请稍后重试。')
    this.busy.add(id)
    let released = false
    return () => { if (!released) { released = true; this.busy.delete(id) } }
  }
}
