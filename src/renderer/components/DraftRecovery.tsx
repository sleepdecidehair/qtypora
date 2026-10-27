import { useLocale, useTranslation } from '../i18n/locale'
import type { DraftRecord } from '../../shared/contracts'
import { FileText } from 'lucide-react'
import { Dialog } from './Dialog'

interface DraftRecoveryProps { drafts: DraftRecord[]; onRecover: (id: string) => void; onDiscard: (id: string) => void; onClose: () => void }

export function DraftRecovery({ drafts, onRecover, onDiscard, onClose }: DraftRecoveryProps) {
  const t = useTranslation()
  const locale = useLocale()
  return <Dialog title={t('恢复草稿')} onClose={onClose} className="recovery-dialog">
    <div className="dialog-content"><p className="setting-hint">{t('这些草稿包含之前未保存到文件的编辑。恢复后请保存文档。')}</p>
      {drafts.length ? drafts.map(draft => <article key={draft.id} className="draft-row"><FileText size={22} /><div><strong>{draft.name}</strong><small>{draft.path ?? t('未保存文档')}</small><small>{new Date(draft.updatedAt).toLocaleString(locale)} · {draft.content.length}{' '}{t('字符')}</small></div><button className="text-button" onClick={() => onDiscard(draft.id)}>{t('丢弃')}</button><button className="primary-button" onClick={() => onRecover(draft.id)}>{t('恢复')}</button></article>) : <p className="empty-hint">{t('没有需要恢复的草稿。')}</p>}
    </div>
    <div className="dialog-footer"><button className="text-button" onClick={onClose}>{t('稍后处理')}</button></div>
  </Dialog>
}
