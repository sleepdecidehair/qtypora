import type { ClipboardContent, DesktopApi } from '../../shared/contracts'

// One queue per desktop bridge orders copies from keyboard, context menu and menu commands.
type ClipboardWriter = Pick<DesktopApi, 'writeClipboard'>
const pendingWrites = new WeakMap<ClipboardWriter, Promise<void>>()

export function queueClipboardWrite(api: ClipboardWriter, content: ClipboardContent, validate?: () => void): Promise<void> {
  const previous = pendingWrites.get(api) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    validate?.()
    const result = await api.writeClipboard(content)
    if (!result.ok) throw new Error(result.error.message)
  })
  pendingWrites.set(api, current)
  return current
}
