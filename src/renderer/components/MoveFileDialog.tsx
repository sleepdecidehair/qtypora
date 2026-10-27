import { useState } from 'react'
import { Dialog } from './Dialog'
import { useLocale, useTranslation } from '../i18n/locale'

interface MoveFileDialogProps { name: string; kind: 'file' | 'directory'; root: string; busy: boolean; onMove: (directory: string) => void; onClose: () => void }

export function MoveFileDialog({ name, kind, root, busy, onMove, onClose }: MoveFileDialogProps) {
  const t = useTranslation()
  const locale = useLocale()
  const [directory, setDirectory] = useState(root)
  return <Dialog title={t(kind === 'directory' ? '移动文件夹' : '移动文件')} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (directory.trim() && !busy) onMove(directory.trim()) }}>
      <div className="dialog-content"><p>{locale === 'en-US' ? <>Move “{name}” to a folder in the current workspace. Open documents and unsaved content will follow the new path.</> : <>将“{name}”移动到当前工作区中的文件夹。已打开的文档和未保存内容将跟随新路径。</>}</p><label className="move-directory-label">{t('目标文件夹')}<input autoFocus aria-label={t('移动目标文件夹')} value={directory} onChange={event => setDirectory(event.target.value)} disabled={busy} /></label><p className="setting-hint">{t('目标已有同名项时停止。移动后可通过文件侧栏“撤销文件操作”恢复。')}</p></div>
      <div className="dialog-footer"><button type="button" className="text-button" disabled={busy} onClick={onClose}>{t('取消')}</button><button type="submit" className="primary-button" disabled={busy || !directory.trim()}>{t(busy ? '正在移动…' : '移动')}</button></div>
    </form>
  </Dialog>
}
