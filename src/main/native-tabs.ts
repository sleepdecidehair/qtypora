import { DesktopError } from './errors'

interface TabWindow {
  isDestroyed(): boolean
  destroy(): void
  show(): void
  addTabbedWindow(window: TabWindow): void
}

/** A new native tab owns its own document session. Never transfer an existing window's documents. */
export async function createNativeTab<T extends TabWindow>(
  platform: NodeJS.Platform,
  parent: T,
  canCreate: () => boolean,
  create: () => Promise<T>,
): Promise<void> {
  if (platform !== 'darwin') throw new DesktopError('UNSUPPORTED', '原生标签页仅在 macOS 上可用。')
  if (parent.isDestroyed() || !canCreate()) throw new DesktopError('CONFLICT', '窗口正在关闭，无法新建标签页。')
  const child = await create()
  try {
    if (parent.isDestroyed() || !canCreate() || child.isDestroyed()) throw new DesktopError('CONFLICT', '窗口已关闭，无法新建标签页。')
    parent.addTabbedWindow(child)
    child.show()
  } catch (error) {
    if (!child.isDestroyed()) child.destroy()
    throw error
  }
}
