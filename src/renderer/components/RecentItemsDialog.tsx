import { useState } from 'react'
import type { DesktopApi, RecentItems } from '../../shared/contracts'
import { useTranslation } from '../i18n/locale'
import { Dialog } from './Dialog'

interface RecentItemsDialogProps {
  api: DesktopApi
  recentItems: RecentItems
  pinnedFolders: string[]
  onClose: () => void
}

export function RecentItemsDialog({ api, recentItems, pinnedFolders, onClose }: RecentItemsDialogProps) {
  const t = useTranslation()
  const [includePinned, setIncludePinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await operation() }
    catch (error) { setError(error instanceof Error ? error.message : t('最近记录操作失败')) }
    finally { setBusy(false) }
  }
  return <Dialog title={t('管理最近记录')} onClose={onClose}>
    <div className="dialog-content">
    <p>{t('只移除历史记录，不会删除文件或关闭已打开的文档。')}</p>
    <div className="recent-items-list">
      <h3>{t('最近目录')}</h3>
      {recentItems.recentFolders.length ? recentItems.recentFolders.map(path => <div className="recent-folder-row" key={path}>
        <span title={path}>{path}{pinnedFolders.includes(path) ? ` · ${t('固定目录')}` : ''}</span>
        <button type="button" disabled={busy} aria-label={`${t('移除最近目录')} ${path}`} onClick={() => void run(async () => {
          const result = await api.removeRecentFolder(path)
          if (!result.ok) throw new Error(result.error.message)
        })}>{t('移除')}</button>
      </div>) : <p className="empty-hint">{t('暂无最近目录')}</p>}
      <p>{t('最近文件')}{' · '}{recentItems.recentFiles.length}</p>
    </div>
    <label><input type="checkbox" checked={includePinned} disabled={busy} onChange={event => setIncludePinned(event.target.checked)} />{t('同时清除固定目录')}</label>
    {error ? <p role="alert">{error}</p> : null}
    </div>
    <div className="dialog-footer"><button type="button" disabled={busy || (!recentItems.recentFiles.length && !recentItems.recentFolders.length && (!includePinned || !pinnedFolders.length))} onClick={() => void run(async () => {
      const result = await api.clearRecentItems({ includePinned })
      if (!result.ok) throw new Error(result.error.message)
    })}>{t('清除最近记录…')}</button><button type="button" onClick={onClose}>{t('关闭')}</button></div>
  </Dialog>
}
