import type { ClipboardContent } from '../shared/contracts'
import { ClipboardArbiter } from './clipboard-arbiter'
import { validateClipboard } from './clipboard'
import { DesktopError } from './errors'

/** Serializes only application API writes, in their arrival order in this process. */
export class ClipboardWriteService {
  constructor(private readonly arbiter: ClipboardArbiter, private readonly write: (content: ClipboardContent) => Promise<void>) {}

  writeFor(owner: number, input: unknown, isOwnerLive: () => boolean): Promise<void> {
    const content = validateClipboard(input)
    return this.arbiter.run(owner, async () => {
      if (!isOwnerLive()) throw new DesktopError('PERMISSION_DENIED', '剪贴板操作窗口已关闭。')
      await this.write(content)
    })
  }
}
