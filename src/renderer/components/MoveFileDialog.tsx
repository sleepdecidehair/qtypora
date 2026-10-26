import { useState } from 'react'
import { Dialog } from './Dialog'

interface MoveFileDialogProps { name: string; root: string; busy: boolean; onMove: (directory: string) => void; onClose: () => void }

export function MoveFileDialog({ name, root, busy, onMove, onClose }: MoveFileDialogProps) {
  const [directory, setDirectory] = useState(root)
  return <Dialog title="移动文件" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (directory.trim() && !busy) onMove(directory.trim()) }}>
      <div className="dialog-content"><p>将“{name}”移动到当前工作区中的文件夹。已打开的文档和未保存内容将跟随新路径。</p><label className="move-directory-label">目标文件夹<input autoFocus aria-label="移动目标文件夹" value={directory} onChange={event => setDirectory(event.target.value)} disabled={busy} /></label><p className="setting-hint">目标已有同名文件时停止。移动后可通过文件侧栏“撤销移动”恢复。</p></div>
      <div className="dialog-footer"><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !directory.trim()}>{busy ? '正在移动…' : '移动'}</button></div>
    </form>
  </Dialog>
}
