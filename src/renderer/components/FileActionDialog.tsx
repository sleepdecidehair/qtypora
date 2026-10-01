import { useState } from 'react'
import type { FileAction } from '../../shared/contracts'
import type { FileContextTarget } from '../hooks/fileContext'
import { Dialog } from './Dialog'

export interface PendingFileAction { action: Exclude<FileAction['action'], 'duplicate'>; path: string; name: string; isDirectory: boolean; contextTarget?: FileContextTarget }
interface FileActionDialogProps { action: PendingFileAction; isSubmitting?: boolean; onSubmit: (name: string) => void; onClose: () => void }

export function FileActionDialog({ action, isSubmitting = false, onSubmit, onClose }: FileActionDialogProps) {
  const [name, setName] = useState(action.action === 'rename' ? action.name : action.action === 'create-file' ? '未命名.md' : '')
  const title = action.action === 'rename' ? '重命名' : action.action === 'create-file' ? '新建 Markdown 文件' : action.action === 'create-folder' ? '新建文件夹' : '移到回收站'
  const isTrash = action.action === 'trash'
  return <Dialog title={title} onClose={onClose} className="file-action-dialog">
    <form onSubmit={event => { event.preventDefault(); onSubmit(name.trim()) }}>
      <div className="dialog-content">{isTrash ? <p>将“{action.name}”移到系统回收站？</p> : <label className="stacked-label">名称<input autoFocus aria-label="文件或文件夹名称" value={name} disabled={isSubmitting} onChange={event => setName(event.target.value)} /></label>}<p className="path-hint">{action.path}</p></div>
      <div className="dialog-footer"><button type="button" className="text-button" disabled={isSubmitting} onClick={onClose}>取消</button><button className={isTrash ? 'danger-button' : 'primary-button'} disabled={isSubmitting || (!isTrash && !name.trim())} type="submit">{isSubmitting ? '正在处理…' : isTrash ? '移到回收站' : '确定'}</button></div>
    </form>
  </Dialog>
}
