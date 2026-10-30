import { useState } from 'react'
import { PAPER_SIZES, type ExportOptions } from '../../shared/export-options'
import { useTranslation } from '../i18n/locale'
import { Dialog } from './Dialog'

export type PageSetupPatch = Partial<Pick<ExportOptions, 'pageSize' | 'pageWidthMm' | 'pageHeightMm' | 'landscape' | 'marginMm' | 'separateMargins' | 'marginTopMm' | 'marginBottomMm' | 'marginLeftMm' | 'marginRightMm'>>

interface Props {
  options: ExportOptions
  onApply: (patch: PageSetupPatch) => Promise<boolean>
  onClose: () => void
}

export function PageSetupDialog({ options, onApply, onClose }: Props) {
  const t = useTranslation()
  const [changes, setChanges] = useState<PageSetupPatch>({})
  const [saving, setSaving] = useState(false)
  const value = { ...options, ...changes }
  const set = (patch: PageSetupPatch) => setChanges(current => ({ ...current, ...patch }))
  const number = (label: string, key: 'pageWidthMm' | 'pageHeightMm' | 'marginMm' | 'marginTopMm' | 'marginBottomMm' | 'marginLeftMm' | 'marginRightMm', min: number, max: number) =>
    <label className="setting-row">{t(label)}<input aria-label={t(label)} type="number" min={min} max={max} value={value[key]} onChange={event => set({ [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
  const close = () => { if (!saving) onClose() }
  const apply = async () => {
    if (saving) return
    setSaving(true)
    try { if (await onApply(changes)) onClose() }
    finally { setSaving(false) }
  }
  return <Dialog title={t('页面设置')} onClose={close} className="preferences-dialog">
    <fieldset disabled={saving} className="dialog-content preferences-content">
      <p>{t('页面设置用于 PDF 导出和打印，并在窗口之间共享。')}</p>
      <label className="setting-row">{t('纸张尺寸')}<select aria-label={t('纸张尺寸')} value={value.pageSize} onChange={event => set({ pageSize: event.target.value as ExportOptions['pageSize'] })}>{PAPER_SIZES.map(size => <option key={size} value={size}>{size === 'custom' ? t('自定义') : size}</option>)}</select></label>
      {value.pageSize === 'custom' ? <>{number('纸张宽度', 'pageWidthMm', 50, 1200)}{number('纸张高度', 'pageHeightMm', 50, 1200)}</> : null}
      <label className="setting-row">{t('横向纸张')}<input type="checkbox" checked={value.landscape} onChange={event => set({ landscape: event.target.checked })} /></label>
      <label className="setting-row">{t('分别设置四边页边距')}<input type="checkbox" checked={value.separateMargins} onChange={event => set({ separateMargins: event.target.checked })} /></label>
      {value.separateMargins ? <>{number('上页边距', 'marginTopMm', 0, 50)}{number('下页边距', 'marginBottomMm', 0, 50)}{number('左页边距', 'marginLeftMm', 0, 50)}{number('右页边距', 'marginRightMm', 0, 50)}</> : number('页边距', 'marginMm', 0, 50)}
    </fieldset>
    <div className="dialog-footer"><button disabled={saving} onClick={close}>{t('取消')}</button><button disabled={saving} className="primary-button" onClick={() => { void apply() }}>{t('完成')}</button></div>
  </Dialog>
}
