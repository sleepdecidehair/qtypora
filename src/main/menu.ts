import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../shared/contracts'
import { translate, type AppLocale } from '../shared/i18n'
import { shortcutForCommand, type ShortcutOverrides } from '../shared/shortcuts'

export interface DesktopMenuItem extends Omit<MenuItemConstructorOptions, 'submenu' | 'click'> {
  submenu?: DesktopMenuItem[]
  click?: () => void
}

export interface MenuActions {
  command(command: AppCommand): void
  openRecent(filePath: string): void
  exit(): void
  help?(): void
  diagnostics?(): void
  thirdPartyNotices?(): void
  checkUpdates?(): void
  about(): void
}

export function createMenuTemplate(platform: NodeJS.Platform, isPackaged: boolean, recentFiles: string[], actions: MenuActions, options: { shortcuts?: ShortcutOverrides; locale?: AppLocale } = {}): DesktopMenuItem[] {
  const isMac = platform === 'darwin'
  const tr = (source: string): string => translate(options.locale ?? 'zh-CN', source)
  const item = (label: string, command: AppCommand, accelerator?: string): DesktopMenuItem => ({ label: tr(label), accelerator: Object.hasOwn(options.shortcuts ?? {}, command) ? options.shortcuts?.[command as keyof ShortcutOverrides] || undefined : shortcutForCommand(command, platform, {}) ?? accelerator, click: () => actions.command(command) })
  const template: DesktopMenuItem[] = [
    { label: tr('文件(&F)'), submenu: [
      item('新建', 'new', 'CmdOrCtrl+N'), item('新建窗口', 'new-window', 'CmdOrCtrl+Shift+N'),
      item('打开…', 'open', 'CmdOrCtrl+O'), item('打开文件夹…', 'open-folder'),
      { label: tr('最近使用的文件'), submenu: recentFiles.length ? recentFiles.map((filePath) => ({
        label: filePath.replaceAll('&', '&&'), click: () => actions.openRecent(filePath),
      })) : [{ label: tr('暂无最近文档'), enabled: false }] },
      { type: 'separator' }, item('保存', 'save', 'CmdOrCtrl+S'), item('另存为…', 'save-as', 'CmdOrCtrl+Shift+S'), item('保存全部', 'save-all'),
      { label: tr('导出'), submenu: [item('HTML…', 'export-html'), item('PDF…', 'export-pdf')] },
      item('更多导出格式与设置…', 'export-options'), item('使用上次导出设置…', 'export-previous'), item('导出并覆盖上次文件…', 'export-overwrite'),
      item('导入文档…', 'import'), item('打印…', 'print', 'CmdOrCtrl+Shift+P'),
      { type: 'separator' }, item('恢复草稿…', 'recover-drafts'), item('关闭文档', 'close-document', 'CmdOrCtrl+W'),
      ...(!isMac ? [{ label: tr('退出'), accelerator: 'Alt+F4', click: actions.exit }] : []),
    ] },
    { label: tr('编辑(&E)'), submenu: [
      item('撤销', 'undo', 'CmdOrCtrl+Z'), item('重做', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'), { type: 'separator' },
      { role: 'cut', label: tr('剪切') }, { role: 'copy', label: tr('复制') }, { role: 'paste', label: tr('粘贴') }, { role: 'selectAll', label: tr('全选') },
      item('选中格式范围 / 表格单元格', 'select-scope', 'CmdOrCtrl+E'),
      item('插入图片…', 'insert-image', 'CmdOrCtrl+Shift+I'), item('上传文档中的本地图片', 'upload-images'),
      item('整理并下载图片到资源目录', 'organize-images'),
      { type: 'separator' }, item('查找', 'find', 'CmdOrCtrl+F'), item('替换', 'replace', 'CmdOrCtrl+H'),
      item('快速打开…', 'quick-open', isMac ? 'Cmd+Shift+O' : 'Ctrl+P'), item('在文件夹中搜索', 'search-folder', 'CmdOrCtrl+Shift+F'),
      { type: 'separator' }, item('偏好设置…', 'preferences', 'CmdOrCtrl+,'),
    ] },
    { label: tr('查看(&V)'), submenu: [
      item('源码模式', 'source', 'CmdOrCtrl+/'), item('显示 / 隐藏侧栏', 'sidebar', 'CmdOrCtrl+Shift+L'),
      item('大纲', 'outline', isMac ? 'Cmd+Ctrl+1' : 'Ctrl+Shift+1'), item('文件树', 'files', isMac ? 'Cmd+Ctrl+3' : 'Ctrl+Shift+3'),
      item('显示 / 隐藏工具栏', 'toolbar'),
      item('字数统计', 'statistics'),
      { type: 'separator' }, item('专注模式', 'focus', 'F8'), item('打字机模式', 'typewriter', 'F9'),
      { type: 'separator' }, item('放大', 'zoom-in', isMac ? undefined : 'Ctrl+Shift+='),
      item('缩小', 'zoom-out', isMac ? undefined : 'Ctrl+Shift+-'), item('实际大小', 'zoom-reset', isMac ? undefined : 'Ctrl+Shift+0'),
      { role: 'togglefullscreen', label: tr('全屏'), accelerator: isMac ? 'Cmd+Alt+F' : 'F11' },
      ...(!isPackaged ? [{ role: 'toggleDevTools' as const, label: tr('开发者工具'), accelerator: 'Shift+F12' }] : []),
    ] },
    { label: tr('窗口(&W)'), submenu: [{ role: 'minimize', label: tr('最小化') }, item('切换文档', 'next-document', isMac ? 'Cmd+`' : 'Ctrl+Tab')] },
    { label: tr('帮助(&H)'), submenu: [{ label: tr('使用帮助'), click: actions.help }, { label: tr('应用诊断'), click: actions.diagnostics }, { label: tr('查看更新与发行记录'), click: actions.checkUpdates }, { label: tr('第三方许可'), click: actions.thirdPartyNotices }, { label: tr('关于 QTypora'), click: actions.about }] },
  ]
  if (isMac) template.unshift({ role: 'appMenu' })
  return template
}
