import type { DraftRecord } from '../../shared/contracts'
import { FileText } from 'lucide-react'
import { Dialog } from './Dialog'

interface DraftRecoveryProps { drafts: DraftRecord[]; onRecover: (id: string) => void; onDiscard: (id: string) => void; onClose: () => void }

export function DraftRecovery({ drafts, onRecover, onDiscard, onClose }: DraftRecoveryProps) {
  return <Dialog title="恢复草稿" onClose={onClose} className="recovery-dialog">
    <div className="dialog-content"><p className="setting-hint">这些草稿包含之前未保存到文件的编辑。恢复后请保存文档。</p>
      {drafts.length ? drafts.map(draft => <article key={draft.id} className="draft-row"><FileText size={22} /><div><strong>{draft.name}</strong><small>{draft.path ?? '未保存文档'}</small><small>{new Date(draft.updatedAt).toLocaleString('zh-CN')} · {draft.content.length} 字符</small></div><button className="text-button" onClick={() => onDiscard(draft.id)}>丢弃</button><button className="primary-button" onClick={() => onRecover(draft.id)}>恢复</button></article>) : <p className="empty-hint">没有需要恢复的草稿。</p>}
    </div>
    <div className="dialog-footer"><button className="text-button" onClick={onClose}>稍后处理</button></div>
  </Dialog>
}
