import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand, LineEnding } from '../shared/contracts'
import { translate, type AppLocale } from '../shared/i18n'
import { shortcutForCommand, type ShortcutOverrides } from '../shared/shortcuts'

export interface DesktopMenuItem extends Omit<MenuItemConstructorOptions, 'submenu' | 'click'> {
  submenu?: DesktopMenuItem[]
  click?: () => void
}

export interface MenuActions {
  command(command: AppCommand): void
  openRecent(filePath: string): void
  minimizeAll(): void
  pastePlain?(): void
  toggleSoftBreaks?(): void
  showEmojiPanel?(): void
  toggleSpellcheck?(): void
  exit(): void
  help?(): void
  diagnostics?(): void
  thirdPartyNotices?(): void
  checkUpdates?(): void
  about(): void
}

export function createMenuTemplate(platform: NodeJS.Platform, isPackaged: boolean, recentFiles: string[], actions: MenuActions, options: { shortcuts?: ShortcutOverrides; locale?: AppLocale; alwaysOnTop?: boolean; indentFirstLine?: boolean; softBreaks?: boolean; canRevealCurrentFile?: boolean; spellcheck?: boolean; lineEnding?: LineEnding; canChangeLineEnding?: boolean; nativeTabsEnabled?: boolean } = {}): DesktopMenuItem[] {
  const isMac = platform === 'darwin'
  const tr = (source: string): string => translate(options.locale ?? 'zh-CN', source)
  const item = (label: string, command: AppCommand, accelerator?: string): DesktopMenuItem => ({ label: tr(label), accelerator: Object.hasOwn(options.shortcuts ?? {}, command) ? options.shortcuts?.[command as keyof ShortcutOverrides] || undefined : shortcutForCommand(command, platform, options.shortcuts ?? {}) ?? accelerator, click: () => actions.command(command) })
  const template: DesktopMenuItem[] = [
    { label: tr('文件(&F)'), submenu: [
      item('新建', 'new', 'CmdOrCtrl+N'), ...(isMac ? [item('新建标签页', 'new-native-tab')] : []), item('新建窗口', 'new-window', 'CmdOrCtrl+Shift+N'),
      item('打开…', 'open', 'CmdOrCtrl+O'), item('打开文件夹…', 'open-folder'),
      ...(isMac ? [{ ...item('在 Finder 中显示当前文件', 'reveal-current-file'), enabled: options.canRevealCurrentFile ?? false }] : []),
      { label: tr('最近使用的文件'), submenu: [item('重新打开关闭的文件', 'reopen-closed'), { type: 'separator' }, ...(recentFiles.length ? recentFiles.map((filePath) => ({
        label: filePath.replaceAll('&', '&&'), click: () => actions.openRecent(filePath),
      })) : [{ label: tr('暂无最近文档'), enabled: false }])] },
      { type: 'separator' }, item('保存', 'save', 'CmdOrCtrl+S'), item('另存为…', 'save-as', 'CmdOrCtrl+Shift+S'), item('保存全部', 'save-all'),
      ...(isMac ? [item('共享…', 'share-document')] : []),
      ...(isMac ? [item('系统版本历史…', 'system-versions')] : []),
      { label: tr('导出'), submenu: [item('HTML…', 'export-html'), item('PDF…', 'export-pdf')] },
      item('更多导出格式与设置…', 'export-options'), item('使用上次导出设置…', 'export-previous'), item('导出并覆盖上次文件…', 'export-overwrite'),
      item('导入文档…', 'import'), item('页面设置…', 'page-setup'), item('打印…', 'print', 'CmdOrCtrl+Shift+P'),
      { type: 'separator' }, item('恢复草稿…', 'recover-drafts'), item('关闭文档', 'close-document', 'CmdOrCtrl+W'),
      ...(!isMac ? [{ label: tr('退出'), accelerator: 'Alt+F4', click: actions.exit }] : []),
    ] },
    { label: tr('编辑(&E)'), submenu: [
      item('撤销', 'undo', 'CmdOrCtrl+Z'), item('重做', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'), { type: 'separator' },
      { role: 'cut', label: tr('剪切') }, { role: 'copy', label: tr('复制') }, { role: 'paste', label: tr('粘贴') }, { label: tr('粘贴为纯文本'), click: actions.pastePlain },
      item('复制为 Markdown', 'copy-markdown'), item('复制为纯文本', 'copy-plain'), item('复制为 HTML 代码', 'copy-html'), { role: 'selectAll', label: tr('全选') },
      item('选中格式范围 / 表格单元格', 'select-scope', 'CmdOrCtrl+E'), item('选中当前段落或块', 'select-block'), item('删除当前块', 'delete-block'), item('删除当前格式文本', 'delete-style'), item('选中当前词', 'select-word'), item('删除当前词', 'delete-word'), item('选中当前行或句', 'select-line'), item('删除当前行或句', 'delete-line'),
      item('跳转到文首', 'jump-start'), item('跳转到文末', 'jump-end'), item('跳转到行首', 'jump-line-start'), item('跳转到行尾', 'jump-line-end'), item('跳转到所选内容', 'jump-selection'),
      item('插入图片…', 'insert-image', 'CmdOrCtrl+Shift+I'), item('上传文档中的本地图片', 'upload-images'),
      item('整理并下载图片到资源目录', 'organize-images'),
      { label: tr('空白与换行'), submenu: [{ ...item('段落首行缩进', 'indent-first-line'), type: 'checkbox', checked: options.indentFirstLine ?? false }, { label: tr('保留软换行'), type: 'checkbox', checked: options.softBreaks ?? false, click: actions.toggleSoftBreaks }] },
      { label: tr('换行符'), submenu: [
        { ...item('Windows 换行符 (CRLF)', 'line-ending-crlf'), type: 'checkbox', checked: options.lineEnding === 'CRLF', enabled: options.canChangeLineEnding ?? false },
        { ...item('Unix 换行符 (LF)', 'line-ending-lf'), type: 'checkbox', checked: options.lineEnding === 'LF', enabled: options.canChangeLineEnding ?? false },
      ] },
      ...(isMac ? [{ label: tr('拼写和语法检查'), submenu: [{ label: tr('键入时检查拼写'), type: 'checkbox' as const, checked: options.spellcheck ?? false, click: actions.toggleSpellcheck }] }] : []),
      { type: 'separator' }, item('查找', 'find', 'CmdOrCtrl+F'), item('查找下一个', 'find-next'), item('查找上一个', 'find-previous'), item('替换', 'replace', 'CmdOrCtrl+H'), item('替换下一个', 'replace-next'),
      item('快速打开…', 'quick-open', isMac ? 'Cmd+Shift+O' : 'Ctrl+P'), item('在文件夹中搜索', 'search-folder', 'CmdOrCtrl+Shift+F'),
      { type: 'separator' }, ...(isMac ? [{ ...item('偏好设置…', 'preferences'), accelerator: undefined }] : [item('偏好设置…', 'preferences', 'CmdOrCtrl+,')]),
      ...(isMac ? [{ type: 'separator' as const }, { label: tr('语音'), submenu: [{ role: 'startSpeaking' as const, label: tr('开始朗读') }, { role: 'stopSpeaking' as const, label: tr('停止朗读') }] }, { label: tr('表情与符号'), click: actions.showEmojiPanel }] : []),
    ] },
    { label: tr('段落'), submenu: [item('一级标题', 'heading-1'), item('二级标题', 'heading-2'), item('三级标题', 'heading-3'), item('四级标题', 'heading-4'), item('五级标题', 'heading-5'), item('六级标题', 'heading-6'), item('正文', 'paragraph'), item('引用', 'quote'), { label: tr('警告框'), submenu: [item('注意', 'insert-alert-note'), item('提示', 'insert-alert-tip'), item('重要', 'insert-alert-important'), item('警告', 'insert-alert-warning'), item('小心', 'insert-alert-caution')] }, item('无序列表', 'bullet-list'), item('有序列表', 'ordered-list'), item('任务列表', 'task-list'), item('插入代码块', 'code'), item('插入数学公式', 'math'), item('插入表格', 'table'), item('分隔线', 'rule'), item('内容目录', 'insert-toc'), item('YAML 前置信息', 'insert-yaml'), item('脚注', 'insert-footnote'), { type: 'separator' }, item('提升标题级别', 'heading-promote'), item('降低标题级别', 'heading-demote'), item('在上方插入段落', 'paragraph-before'), item('在下方插入段落', 'paragraph-after'), { label: tr('任务状态'), submenu: [item('切换任务状态', 'task-toggle'), item('标记为已完成', 'task-check'), item('标记为未完成', 'task-uncheck')] }] },
    { label: tr('格式'), submenu: [item('加粗', 'bold'), item('斜体', 'italic'), item('下划线', 'underline'), item('删除线', 'strike'), item('高亮', 'highlight'), item('上标', 'superscript'), item('下标', 'subscript'), item('行内代码', 'inline-code'), item('行内数学', 'inline-math'), item('注释', 'html-comment'), item('插入链接', 'link'), item('清除格式', 'clear-format')] },
    { label: tr('查看(&V)'), submenu: [
      item('源码模式', 'source', 'CmdOrCtrl+/'), item('显示 / 隐藏侧栏', 'sidebar', 'CmdOrCtrl+Shift+L'),
      item('大纲', 'outline', isMac ? 'Cmd+Ctrl+1' : 'Ctrl+Shift+1'), item('文档列表', 'article-list'), item('文件树', 'files', isMac ? 'Cmd+Ctrl+3' : 'Ctrl+Shift+3'),
      item('显示 / 隐藏工具栏', 'toolbar'),
      item('显示 / 隐藏状态栏', 'statusbar'),
      { ...item('窗口置顶 / 取消置顶', 'toggle-always-on-top'), type: 'checkbox', checked: options.alwaysOnTop ?? false },
      item('字数统计', 'statistics'),
      { type: 'separator' }, item('专注模式', 'focus', 'F8'), item('打字机模式', 'typewriter', 'F9'),
      { type: 'separator' }, item('放大', 'zoom-in', isMac ? undefined : 'Ctrl+Shift+='),
      item('缩小', 'zoom-out', isMac ? undefined : 'Ctrl+Shift+-'), item('实际大小', 'zoom-reset', isMac ? undefined : 'Ctrl+Shift+0'),
      { role: 'togglefullscreen', label: tr('全屏'), accelerator: isMac ? 'Cmd+Alt+F' : 'F11' },
      ...(!isPackaged ? [{ role: 'toggleDevTools' as const, label: tr('开发者工具'), accelerator: 'Shift+F12' }] : []),
    ] },
    { label: tr('窗口(&W)'), submenu: [
      { role: 'minimize', label: tr('最小化') },
      ...(isMac ? [{ label: tr('全部最小化'), click: actions.minimizeAll }, { role: 'zoom' as const, label: tr('缩放') }, { role: 'front' as const, label: tr('前置全部窗口') }] : []),
      item('切换文档', 'next-document', isMac ? 'Cmd+`' : 'Ctrl+Tab'),
      ...(isMac && options.nativeTabsEnabled ? [
        { type: 'separator' as const },
        { role: 'toggleTabBar' as const, label: tr('显示 / 隐藏标签栏') },
        { role: 'selectPreviousTab' as const, label: tr('选择上一个标签页') },
        { role: 'selectNextTab' as const, label: tr('选择下一个标签页') },
        { role: 'showAllTabs' as const, label: tr('显示所有标签页') },
        { role: 'moveTabToNewWindow' as const, label: tr('将标签页移至新窗口') },
      ] : []),
    ] },
    { label: tr('帮助(&H)'), submenu: [{ label: tr('使用帮助'), click: actions.help }, { label: tr('应用诊断'), click: actions.diagnostics }, { label: tr('查看更新与发行记录'), click: actions.checkUpdates }, { label: tr('第三方许可'), click: actions.thirdPartyNotices }, { label: tr('关于 QTypora'), click: actions.about }] },
  ]
  if (isMac) template.unshift({ role: 'appMenu', submenu: [
    { role: 'about' }, { type: 'separator' }, item('设置…', 'preferences', 'CmdOrCtrl+,'), { type: 'separator' },
    { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
  ] })
  return template
}
