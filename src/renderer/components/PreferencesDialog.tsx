import type { Preferences, Theme } from '../../shared/contracts'
import { Dialog } from './Dialog'

interface PreferencesDialogProps {
  preferences: Preferences
  onChange: (changes: Partial<Preferences>) => void
  onClose: () => void
}

export function PreferencesDialog({ preferences, onChange, onClose }: PreferencesDialogProps) {
  return <Dialog title="偏好设置" onClose={onClose} className="preferences-dialog">
    <div className="dialog-content preferences-content">
      <section><h3>外观</h3>
        <label className="setting-row">主题<select data-testid="theme-select" value={preferences.theme} onChange={event => onChange({ theme: event.target.value as Theme })}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
        <label className="setting-row">正文字号<div><input aria-label="正文字号" type="number" min={12} max={32} value={preferences.fontSize} onChange={event => { const value = Number(event.target.value); if (value >= 12 && value <= 32) onChange({ fontSize: value }) }} /><span> px</span></div></label>
        <label className="setting-row">正文布局<select aria-label="正文布局" value={preferences.contentWidthMode} onChange={event => onChange({ contentWidthMode: event.target.value === 'fixed' ? 'fixed' : 'auto' })}><option value="auto">适应窗口</option><option value="fixed">固定宽度</option></select></label>
        <label className="setting-row">正文最大宽度<div><input aria-label="正文最大宽度" type="number" min={480} max={1440} step={40} disabled={preferences.contentWidthMode === 'auto'} value={preferences.contentWidth} onChange={event => { const value = Number(event.target.value); if (value >= 480 && value <= 1440) onChange({ contentWidth: value }) }} /><span> px</span></div></label>
        <label className="setting-row">显示格式工具栏<input type="checkbox" checked={preferences.showToolbar} onChange={event => onChange({ showToolbar: event.target.checked })} /></label>
        <label className="setting-row">显示侧栏<input type="checkbox" checked={preferences.showSidebar} onChange={event => onChange({ showSidebar: event.target.checked })} /></label>
      </section>
      <section><h3>编辑</h3>
        <label className="setting-row">源码模式 · Ctrl+/<input type="checkbox" checked={preferences.sourceMode} onChange={event => onChange({ sourceMode: event.target.checked, readingMode: false })} /></label>
        <p className="setting-hint">双击正文展开当前行语法，双击图片、公式、图表或表格展开对应块；移开光标或 Esc 恢复预览。Ctrl+/ 切换全文源码模式；Ctrl+E 选择当前样式范围或表格单元格。</p>
        <label className="setting-row">专注模式<input type="checkbox" checked={preferences.focusMode} onChange={event => onChange({ focusMode: event.target.checked })} /></label>
        <label className="setting-row">打字机模式<input type="checkbox" checked={preferences.typewriterMode} onChange={event => onChange({ typewriterMode: event.target.checked })} /></label>
        <label className="setting-row">源码显示行号<input type="checkbox" checked={preferences.showLineNumbers} onChange={event => onChange({ showLineNumbers: event.target.checked })} /></label>
        <label className="setting-row">自动换行<input type="checkbox" checked={preferences.wrapLines} onChange={event => onChange({ wrapLines: event.target.checked })} /></label>
        <label className="setting-row">拼写检查<input type="checkbox" checked={preferences.spellcheck} onChange={event => onChange({ spellcheck: event.target.checked })} /></label>
      </section>
      <section><h3>文件</h3>
        <label className="setting-row">定时保存到原文件<input data-testid="autosave-toggle" type="checkbox" checked={preferences.autoSave} onChange={event => onChange({ autoSave: event.target.checked })} /></label>
        <label className="setting-row">保存间隔<div><input aria-label="自动保存间隔" type="number" min={10} max={3600} disabled={!preferences.autoSave} value={preferences.autoSaveSeconds} onChange={event => { const value = Number(event.target.value); if (value >= 10 && value <= 3600) onChange({ autoSaveSeconds: value }) }} /><span> 秒</span></div></label>
        <label className="setting-row">新文档换行<select value={preferences.lineEnding} onChange={event => onChange({ lineEnding: event.target.value === 'CRLF' ? 'CRLF' : 'LF' })}><option value="LF">LF</option><option value="CRLF">CRLF · Windows</option></select></label>
        <p className="setting-hint">编辑中的草稿会独立保存以便异常退出后恢复。已有文件保留其编码和换行方式。</p>
      </section>
    </div>
    <div className="dialog-footer"><span>设置自动保存</span><button className="primary-button" onClick={onClose}>完成</button></div>
  </Dialog>
}
