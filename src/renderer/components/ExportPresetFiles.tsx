import { useEffect, useRef, useState } from 'react'
import type { DesktopApi } from '../../shared/contracts'
import type { ExportOptions, SavedExportPreset } from '../../shared/export-options'
import type { ImportedExportPresets, PresetConflictStrategy } from '../../shared/export-preset-file'

interface ExportPresetFilesProps { api: DesktopApi; options: ExportOptions; onImportPresets: (presets: SavedExportPreset[], strategy: PresetConflictStrategy) => Promise<void> }

export function ExportPresetFiles({ api, options, onImportPresets }: ExportPresetFilesProps) {
  const [preview, setPreview] = useState<ImportedExportPresets | null>(null)
  const [strategy, setStrategy] = useState<PresetConflictStrategy>('keep')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const transfer = async (direction: 'import' | 'export') => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (direction === 'import') {
        const result = await api.importExportPresets()
        if (!active.current) return
        if (!result.ok) throw new Error(result.error.message)
        if (result.data) { setPreview(result.data); setStrategy('keep') }
      } else {
        const result = await api.exportExportPresets(options.savedPresets)
        if (!active.current) return
        if (!result.ok) throw new Error(result.error.message)
        if (result.data) setNotice(`预设已导出：${result.data}`)
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '预设文件操作失败。') }
    finally { if (active.current) setBusy(false) }
  }
  const confirm = async () => {
    if (!preview || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await onImportPresets(preview.data.presets, strategy)
      if (active.current) { setPreview(null); setNotice('预设已导入并保存。') }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '无法合并导出预设。') }
    finally { if (active.current) setBusy(false) }
  }
  return <section aria-label="预设文件">
    <div className="setting-actions"><button disabled={busy} onClick={() => { void transfer('import') }}>导入预设 JSON…</button><button disabled={busy || !options.savedPresets.length} onClick={() => { void transfer('export') }}>导出预设 JSON…</button></div>
    <p className="setting-hint">文件只包含内建格式和页面设置，不包含自定义程序、模板或 Pandoc 路径。导入不会执行文档导出。</p>
    {preview ? <fieldset aria-label="预设导入预览">
      <legend>导入预览 · {preview.fileName}</legend>
      <ul>{preview.data.presets.map(preset => <li key={preset.name}>{preset.name} · {preset.format.toUpperCase()} · {preset.settings.pageSize}{options.savedPresets.some(item => item.name === preset.name) ? '（同名冲突）' : '（新增）'}</li>)}</ul>
      {!preview.data.presets.length ? <p>文件未包含预设。</p> : null}
      <label><input type="radio" name="preset-conflict" disabled={busy} checked={strategy === 'keep'} onChange={() => setStrategy('keep')} />保留已有同名预设，仅添加新名称（默认）</label>
      <label><input type="radio" name="preset-conflict" disabled={busy} checked={strategy === 'replace'} onChange={() => setStrategy('replace')} />使用导入内容覆盖同名预设</label>
      <div className="setting-actions"><button disabled={busy} onClick={() => { setPreview(null); setError('') }}>取消导入</button><button disabled={busy || !preview.data.presets.length} onClick={() => { void confirm() }}>{strategy === 'keep' ? '导入（保留已有同名预设）' : '导入并覆盖同名预设'}</button></div>
    </fieldset> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
  </section>
}
