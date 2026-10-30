import { useTranslation } from '../i18n/locale'
import { useState, type ReactNode } from 'react'
import type { DesktopApi, Preferences, Theme } from '../../shared/contracts'
import type { MarkdownOptions } from '../../shared/markdown-options'
import { PAPER_SIZES } from '../../shared/export-options'
import { ShortcutSettings } from './ShortcutSettings'
import { CustomExportSettings } from './CustomExportSettings'
import { SpellingDictionary } from './SpellingDictionary'
import { Dialog } from './Dialog'
import { primaryShortcut } from '../platform-shortcuts'
import { TyporaThemeSettings } from './TyporaThemeSettings'

interface PreferencesDialogProps {
  desktopApi: DesktopApi
  platform: string
  preferences: Preferences
  onChange: (changes: Partial<Preferences>) => void
  onClose: () => void
  onThemeRefresh?: (id: string) => void
}

export function PreferencesDialog({ desktopApi, platform, preferences: p, onChange, onClose, onThemeRefresh }: PreferencesDialogProps) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const row = (label: string, input: ReactNode) => !query || label.toLowerCase().includes(query.toLowerCase()) || t(label).toLowerCase().includes(query.toLowerCase()) ? <label key={label} className="setting-row">{t(label)}{input}</label> : null
  const checkbox = (checked: boolean, set: (value: boolean) => void, testId?: string) => <input data-testid={testId} type="checkbox" checked={checked} onChange={event => set(event.target.checked)} />
  const number = (label: string, value: number, min: number, max: number, set: (value: number) => void, step = 1) => <input aria-label={t(label)} type="number" value={value} min={min} max={max} step={step} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next) && next >= min && next <= max) set(next) }} />
  const text = (label: string, value: string, set: (value: string) => void, placeholder = '') => <input aria-label={t(label)} value={value} placeholder={t(placeholder)} onChange={event => set(event.target.value)} />
  const markdownSwitches: [keyof MarkdownOptions, string][] = [
    ['strictMode', '严格 Markdown（CommonMark）'],
    ['frontMatter', 'YAML 前置信息'], ['toc', '自动目录 TOC'], ['alerts', 'GitHub Alerts 提示块'], ['highlight', '高亮 ==文字=='], ['subscript', '下标'], ['superscript', '上标'], ['footnotes', '脚注'], ['emoji', 'Emoji 表情语法'], ['inlineMath', '行内数学'], ['mathNumbering', '公式自动编号'], ['diagrams', 'Mermaid 图表'], ['smartPunctuation', '智能标点（显示时转换）'], ['smartDashInput', '智能破折号（键入时转换）'], ['softBreaks', '保留软换行'], ['autoPairBrackets', '自动配对括号和引号'], ['autoPairMarkdown', '自动配对 Markdown 标记'], ['codeLineNumbers', '代码块行号'], ['codeWrapLines', '代码块自动换行'],
  ]
  return <Dialog title={t('偏好设置')} onClose={onClose} className="preferences-dialog">
    <div className="preferences-search"><input aria-label={t('搜索设置')} placeholder={t('搜索设置名称…')} value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="dialog-content preferences-content">
      <section><h3>{t('外观')}</h3>
        {row('语言 / Language', <select aria-label={t('语言 / Language')} value={p.locale} onChange={event => onChange({ locale: event.target.value === 'en-US' ? 'en-US' : 'zh-CN' })}><option value="zh-CN">简体中文</option><option value="en-US">English (preview)</option></select>)}
        {p.locale === 'en-US' ? <p className="setting-hint">{t('英语目前为预览版，部分编辑器、文件和错误消息仍显示中文。')}</p> : null}
        {row('主题', <select data-testid="theme-select" value={p.theme} onChange={event => onChange({ theme: event.target.value as Theme })}><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option><option value="system">{t('跟随系统')}</option></select>)}
        {row('浅色配色', <select aria-label={t('浅色配色')} value={p.lightTheme} onChange={event => onChange({ lightTheme: event.target.value as Preferences['lightTheme'] })}><option value="paper">{t('纸白')}</option><option value="sepia">{t('暖纸')}</option><option value="blue">{t('雾蓝')}</option></select>)}
        {row('深色配色', <select aria-label={t('深色配色')} value={p.darkTheme} onChange={event => onChange({ darkTheme: event.target.value as Preferences['darkTheme'] })}><option value="night">{t('夜色')}</option><option value="charcoal">{t('炭黑')}</option></select>)}
        {(!query || 'Typora 主题'.toLowerCase().includes(query.toLowerCase()) || t('Typora 主题').toLowerCase().includes(query.toLowerCase())) ? <TyporaThemeSettings api={desktopApi} selectedId={p.typoraThemeId} onChange={typoraThemeId => onChange({ typoraThemeId })} onRefresh={onThemeRefresh} /> : null}
        {row('正文字号', number('正文字号', p.fontSize, 12, 32, fontSize => onChange({ fontSize })))}
        {row('正文字体', text('正文字体', p.fontFamily, fontFamily => onChange({ fontFamily }), '系统默认，可填写本机字体名'))}
        {row('正文行距', number('正文行距', p.lineHeight, 1, 3, lineHeight => onChange({ lineHeight }), 0.1))}
        {row('正文布局', <select aria-label={t('正文布局')} value={p.contentWidthMode} onChange={event => onChange({ contentWidthMode: event.target.value === 'fixed' ? 'fixed' : 'auto' })}><option value="auto">{t('适应窗口')}</option><option value="fixed">{t('固定宽度')}</option></select>)}
        {row('正文最大宽度', <input aria-label={t('正文最大宽度')} type="number" min={480} max={1440} step={40} disabled={p.contentWidthMode === 'auto'} value={p.contentWidth} onChange={event => { const value = Number(event.target.value); if (value >= 480 && value <= 1440) onChange({ contentWidth: value }) }} />)}
        {platform === 'darwin' ? row('使用原生标签页（新窗口生效）', checkbox(p.macNativeTabs, macNativeTabs => onChange({ macNativeTabs }))) : null}
        {row('显示格式工具栏', checkbox(p.showToolbar, showToolbar => onChange({ showToolbar })))}
        {row('浮动格式工具栏', checkbox(p.floatingToolbar, floatingToolbar => onChange({ floatingToolbar })))}
        {row('显示侧栏', checkbox(p.showSidebar, showSidebar => onChange({ showSidebar })))}
        {row('阅读速度（字/分钟）', number('阅读速度', p.readingSpeed, 50, 2000, readingSpeed => onChange({ readingSpeed })))}
        {row('正文自定义 CSS', <textarea aria-label={t('正文自定义 CSS')} rows={4} value={p.customCss} placeholder="p { line-height: 2; }" onChange={event => onChange({ customCss: event.target.value.slice(0, 40000) })} />)}
        <p className="setting-hint">{t('自定义样式只作用于文章内容，支持普通 CSS 规则；不加载外部资源或 @import。')}</p>
        <label className="setting-row">{t('导入主题 CSS')}<input aria-label={t('导入主题 CSS')} type="file" accept=".css,text/css" onChange={event => { const file = event.target.files?.[0]; if (file && file.size <= 40000) void file.text().then(customCss => onChange({ customCss })) }} /></label>
      </section>
      <section><h3>{t('编辑')}</h3>
        {row(`${t('源码模式')} · ${primaryShortcut(platform, '/')}`, checkbox(p.sourceMode, sourceMode => onChange({ sourceMode, readingMode: false })))}
        {row('专注模式', checkbox(p.focusMode, focusMode => onChange({ focusMode })))}
        {row('打字机模式', checkbox(p.typewriterMode, typewriterMode => onChange({ typewriterMode })))}
        {row('源码显示行号', checkbox(p.showLineNumbers, showLineNumbers => onChange({ showLineNumbers })))}
        {row('自动换行', checkbox(p.wrapLines, wrapLines => onChange({ wrapLines })))}
        {row('拼写检查', checkbox(p.spellcheck, spellcheck => onChange({ spellcheck })))}
        {row('拼写语言', <select aria-label={t('拼写语言')} value={p.spellcheckLanguages[0] ?? 'en-US'} onChange={event => onChange({ spellcheckLanguages: [event.target.value] })}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="es">Español</option></select>)}
        <p className="setting-hint">{t('macOS 使用系统拼写语言；其他平台使用运行时可用的词典。')}</p>
        <SpellingDictionary api={desktopApi} />
      </section>
      <section><h3>{t('Markdown 与代码块')}</h3>
        {markdownSwitches.map(([key, label]) => row(label, checkbox(Boolean(p.markdown[key]), value => onChange({ markdown: { ...p.markdown, [key]: value } }))))}
        {p.markdown.strictMode ? <p className="setting-hint">{t('严格模式按 CommonMark 显示，暂时停用表格、任务、公式和其他扩展。关闭后恢复原有扩展设置，原文不变。')}</p> : null}
        {row('代码缩进宽度', number('代码缩进宽度', p.markdown.codeIndentSize, 1, 8, codeIndentSize => onChange({ markdown: { ...p.markdown, codeIndentSize } })))}
        {row('默认代码语言', text('默认代码语言', p.markdown.defaultCodeLanguage, defaultCodeLanguage => { if (/^[\w+#.-]{0,40}$/.test(defaultCodeLanguage)) onChange({ markdown: { ...p.markdown, defaultCodeLanguage } }) }))}
        {row('默认语言应用方式', <select aria-label={t('默认语言应用方式')} value={p.markdown.codeDefaultLanguageMode} onChange={event => onChange({ markdown: { ...p.markdown, codeDefaultLanguageMode: event.target.value as MarkdownOptions['codeDefaultLanguageMode'] } })}><option value="both">{t('Markdown 输入与菜单')}</option><option value="typed">{t('仅 Markdown 输入')}</option><option value="menu">{t('仅菜单及快捷键')}</option></select>)}
        {row('Shift+Tab 自动缩进代码', checkbox(p.markdown.codeShiftTabAutoIndent, codeShiftTabAutoIndent => onChange({ markdown: { ...p.markdown, codeShiftTabAutoIndent } })))}
        {row('复制时纯文本使用 Markdown 原文', checkbox(p.markdown.copyPlainMarkdown, copyPlainMarkdown => onChange({ markdown: { ...p.markdown, copyPlainMarkdown } })))}
      </section>
      <section><h3>{t('图片与剪贴板')}</h3>
        {row('图片保存子目录', text('图片保存子目录', p.image.directory, directory => onChange({ image: { ...p.image, directory } }), 'assets'))}
        {row('图片使用相对路径', checkbox(p.image.useRelativePath, useRelativePath => onChange({ image: { ...p.image, useRelativePath } })))}
        {row('富文本智能粘贴', checkbox(p.image.smartPaste, smartPaste => onChange({ image: { ...p.image, smartPaste } })))}
        {row('图片上传器路径', text('图片上传器路径', p.image.uploaderExecutable, uploaderExecutable => onChange({ image: { ...p.image, uploaderExecutable } }), '可执行文件绝对路径'))}
        {row('上传器参数（每行一个）', <textarea aria-label={t('上传器参数')} rows={3} value={p.image.uploaderArgs.join('\n')} onChange={event => onChange({ image: { ...p.image, uploaderArgs: event.target.value.split('\n') } })} />)}
        {row('插入图片后自动上传', checkbox(p.image.uploadOnInsert, uploadOnInsert => onChange({ image: { ...p.image, uploadOnInsert } })))}
        <p className="setting-hint">{t('上传器参数中的')}{' '}{'{files}'}{' '}{t('将展开为本地图片路径；程序需逐行输出 HTTP(S) 图片地址。手动上传入口在编辑菜单。')}</p>
        <p className="setting-hint">{t('可粘贴或拖放图片；未保存文档会先选择图片目录。源码模式粘贴文本时保留原文。')}</p>
      </section>
      <section><h3>{t('应用快捷键')}</h3><ShortcutSettings platform={platform} shortcuts={p.shortcuts} filter={query} onChange={shortcuts => onChange({ shortcuts })} /></section>
      <section><h3>{t('文件')}</h3>
        {row('定时保存到原文件', checkbox(p.autoSave, autoSave => onChange({ autoSave }), 'autosave-toggle'))}
        {row('自动保存间隔', number('自动保存间隔', p.autoSaveSeconds, 10, 3600, autoSaveSeconds => onChange({ autoSaveSeconds })))}
        {row('新文档换行', <select value={p.lineEnding} onChange={event => onChange({ lineEnding: event.target.value === 'CRLF' ? 'CRLF' : 'LF' })}><option value="LF">LF</option><option value="CRLF">CRLF · Windows</option></select>)}
        {row('启动方式', <select aria-label={t('启动方式')} value={p.startup} onChange={event => onChange({ startup: event.target.value as Preferences['startup'] })}><option value="new">{t('新建文档')}</option><option value="last-file">{t('恢复最近文件')}</option><option value="last-folder">{t('恢复最近文件夹')}</option><option value="custom-folder">{t('打开指定文件夹')}</option></select>)}
        {p.startup === 'custom-folder' ? row('启动文件夹', text('启动文件夹', p.startupFolder, startupFolder => onChange({ startupFolder }))) : null}
        <p className="setting-hint">{t('编辑草稿独立保存。原文件保留既有编码和换行方式。')}</p>
      </section>
      <section><h3>{t('导出与打印')}</h3>
        {row('导出主题', <select aria-label={t('导出主题')} value={p.export.theme} onChange={event => onChange({ export: { ...p.export, theme: event.target.value as Preferences['export']['theme'] } })}><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option><option value="current">{t('与编辑器一致')}</option></select>)}
        {row('纸张尺寸', <select aria-label={t('纸张尺寸')} value={p.export.pageSize} onChange={event => onChange({ export: { ...p.export, pageSize: event.target.value as Preferences['export']['pageSize'] } })}>{PAPER_SIZES.map(size => <option key={size} value={size}>{size === 'custom' ? t('自定义') : size}</option>)}</select>)}
        {p.export.pageSize === 'custom' ? <>{row('纸张宽度（毫米）', number('纸张宽度', p.export.pageWidthMm, 50, 1200, pageWidthMm => onChange({ export: { ...p.export, pageWidthMm } })))}{row('纸张高度（毫米）', number('纸张高度', p.export.pageHeightMm, 50, 1200, pageHeightMm => onChange({ export: { ...p.export, pageHeightMm } })))}</> : null}
        {row('横向纸张', checkbox(p.export.landscape, landscape => onChange({ export: { ...p.export, landscape } })))}
        {row('页边距（毫米）', number('页边距', p.export.marginMm, 0, 50, marginMm => onChange({ export: { ...p.export, marginMm } })))}
        {row('分别设置四边页边距', checkbox(p.export.separateMargins, separateMargins => onChange({ export: { ...p.export, separateMargins } })))}
        {p.export.separateMargins ? (['Top', 'Bottom', 'Left', 'Right'] as const).map((side, index) => {
          const key = `margin${side}Mm` as const
          const label = `${['上', '下', '左', '右'][index]}页边距`
          return row(`${label}（毫米）`, number(label, p.export[key], 0, 50, value => onChange({ export: { ...p.export, [key]: value } })))
        }) : null}
        {row('页眉', text('页眉', p.export.header, header => onChange({ export: { ...p.export, header } })))}
        {row('页脚', text('页脚', p.export.footer, footer => onChange({ export: { ...p.export, footer } })))}
        {row('PDF 页码', checkbox(p.export.pageNumbers, pageNumbers => onChange({ export: { ...p.export, pageNumbers } })))}
        {row('PDF 大纲书签', checkbox(p.export.outline, outline => onChange({ export: { ...p.export, outline } })))}
        {row('长图宽度', number('长图宽度', p.export.imageWidth, 480, 2400, imageWidth => onChange({ export: { ...p.export, imageWidth } })))}
        <CustomExportSettings options={p.export} onChange={options => onChange({ export: options })} />
        {row('Pandoc 路径', text('Pandoc 路径', p.export.pandocPath, pandocPath => onChange({ export: { ...p.export, pandocPath } }), '留空使用 PATH 中的 pandoc'))}
      </section>
    </div>
    <div className="dialog-footer"><span>{t('设置自动保存')}</span><button className="primary-button" onClick={onClose}>{t('完成')}</button></div>
  </Dialog>
}
