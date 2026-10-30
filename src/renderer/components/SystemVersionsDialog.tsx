import { useEffect, useRef, useState } from 'react'
import type { DesktopApi, DocumentSnapshot, SystemVersionSummary } from '../../shared/contracts'
import { translateKnownError } from '../../shared/i18n'
import type { EditorDocument } from '../hooks/useDocuments'
import { useLocale, useTranslation } from '../i18n/locale'
import { Dialog } from './Dialog'

export interface VersionScope { snapshot: DocumentSnapshot; path: string | null; version: string | null; externalChange: EditorDocument['externalChange'] }
export function versionScopeMatches(scope: VersionScope, current: EditorDocument | null): boolean {
  return !!current && current.id === scope.snapshot.id && current.revision === scope.snapshot.revision && current.content === scope.snapshot.content && current.path === scope.path && current.version === scope.version && current.externalChange === scope.externalChange
}

export function SystemVersionsDialog({ api, scope, current, onClose }: { api: Pick<DesktopApi, 'listSystemVersions' | 'readSystemVersion'>; scope: VersionScope; current: EditorDocument | null; onClose: () => void }) {
  const t = useTranslation()
  const locale = useLocale()
  const [invalidated, setInvalidated] = useState(false)
  const stillValid = useRef(true)
  if (!versionScopeMatches(scope, current)) stillValid.current = false
  const valid = stillValid.current && !invalidated
  const validRef = useRef(valid)
  validRef.current = valid
  const sequence = useRef(0)
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<SystemVersionSummary[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const request = ++sequence.current
    void api.listSystemVersions(scope.snapshot).then(result => {
      if (request !== sequence.current || !validRef.current) return
      setLoading(false)
      if (result.ok) setVersions(result.data)
      else { setError(result.error.message); if (result.error.code === 'CONFLICT') setInvalidated(true) }
    }).catch(reason => {
      if (request !== sequence.current || !validRef.current) return
      setLoading(false); setError(reason instanceof Error ? reason.message : '无法读取系统版本历史。')
    })
    return () => { sequence.current++ }
  }, [api, scope])
  const read = async (token: string) => {
    const request = ++sequence.current
    setSelected(token); setPreview(null); setError(''); setLoading(true)
    try {
      const result = await api.readSystemVersion({ snapshot: scope.snapshot, token })
      if (request !== sequence.current || !validRef.current) return
      if (result.ok) setPreview(result.data.content)
      else { setError(result.error.message); if (result.error.code === 'CONFLICT') setInvalidated(true) }
    } catch (reason) {
      if (request !== sequence.current || !validRef.current) return
      setError(reason instanceof Error ? reason.message : '无法读取系统版本历史。')
    } finally { if (request === sequence.current && validRef.current) setLoading(false) }
  }
  return <Dialog title={t('系统版本历史')} onClose={onClose} className="system-versions-dialog">
    <div className="dialog-content">
      <p className="setting-hint">{t('只读预览 macOS 系统保存的历史版本，不会恢复或修改当前文档。')}</p>
      {!valid ? <p role="alert">{invalidated && error ? translateKnownError(locale, error) : t('文档已变化或切换，请关闭并重新打开版本历史。')}</p> : <>
        {error ? <p role="alert">{translateKnownError(locale, error)}</p> : null}
        {loading ? <p role="status">{t('正在读取版本…')}</p> : null}
        {!loading && !error && versions.length === 0 ? <p>{t('系统未返回历史版本；这可能表示没有版本，或系统版本服务暂不可用。')}</p> : null}
        <div role="group" aria-label={t('可用版本')}>
          {versions.map(version => <button type="button" key={version.token} aria-pressed={selected === version.token} disabled={loading} onClick={() => { void read(version.token) }}>{new Date(version.modifiedAt).toLocaleString(locale)}</button>)}
        </div>
        {preview !== null ? <section aria-label={t('历史版本原文')}><h3>{t('历史版本原文')}</h3><pre className="system-version-preview">{preview}</pre></section> : null}
      </>}
    </div>
    <div className="dialog-footer"><button type="button" className="text-button" onClick={onClose}>{t('关闭')}</button></div>
  </Dialog>
}
