import type { AppCommand } from './contracts'

export const SHORTCUT_DEFINITIONS = [
  { command: 'new', label: '新建文档', shortcut: 'CmdOrCtrl+N' },
  { command: 'new-window', label: '新建窗口', shortcut: 'CmdOrCtrl+Shift+N' },
  { command: 'open', label: '打开文档', shortcut: 'CmdOrCtrl+O' },
  { command: 'open-folder', label: '打开文件夹', shortcut: 'Ctrl+Shift+O', mac: '' },
  { command: 'save', label: '保存', shortcut: 'CmdOrCtrl+S' },
  { command: 'save-as', label: '另存为', shortcut: 'CmdOrCtrl+Shift+S' },
  { command: 'save-all', label: '保存全部', shortcut: '' },
  { command: 'reopen-closed', label: '重新打开关闭的文件', shortcut: 'CmdOrCtrl+Shift+T' },
  { command: 'close-document', label: '关闭文档', shortcut: 'CmdOrCtrl+W' },
  { command: 'export-html', label: '导出 HTML', shortcut: '' },
  { command: 'export-pdf', label: '导出 PDF', shortcut: '' },
  { command: 'export-options', label: '导出设置', shortcut: '' },
  { command: 'export-previous', label: '使用上次导出设置', shortcut: '' },
  { command: 'export-overwrite', label: '覆盖上次导出文件', shortcut: '' },
  { command: 'import', label: '导入文档', shortcut: '' },
  { command: 'page-setup', label: '页面设置', shortcut: '' },
  { command: 'print', label: '打印', shortcut: 'CmdOrCtrl+Shift+P' },
  { command: 'recover-drafts', label: '恢复草稿', shortcut: '' },
  { command: 'select-scope', label: '选中格式范围', shortcut: 'CmdOrCtrl+E' },
  { command: 'select-line', label: '选中当前行或句', shortcut: 'CmdOrCtrl+L' },
  { command: 'copy-markdown', label: '复制为 Markdown', shortcut: 'CmdOrCtrl+Shift+C' },
  { command: 'delete-word', label: '删除当前词', shortcut: 'CmdOrCtrl+Shift+D' },
  { command: 'delete-line', label: '删除当前行或句', shortcut: 'CmdOrCtrl+Shift+Backspace' },
  { command: 'jump-selection', label: '跳转到所选内容', shortcut: 'CmdOrCtrl+J' },
  { command: 'insert-image', label: '插入图片', shortcut: 'CmdOrCtrl+Shift+I' },
  { command: 'upload-images', label: '上传文档图片', shortcut: '' },
  { command: 'organize-images', label: '整理本地图片', shortcut: '' },
  { command: 'replace', label: '替换', shortcut: 'CmdOrCtrl+H' },
  { command: 'quick-open', label: '快速打开', shortcut: 'Ctrl+P', mac: 'Cmd+Shift+O' },
  { command: 'search-folder', label: '目录搜索', shortcut: 'CmdOrCtrl+Shift+F' },
  { command: 'preferences', label: '偏好设置', shortcut: 'CmdOrCtrl+,' },
  { command: 'source', label: '源码模式', shortcut: 'CmdOrCtrl+/' },
  { command: 'sidebar', label: '显示侧栏', shortcut: 'CmdOrCtrl+Shift+L' },
  { command: 'outline', label: '大纲', shortcut: 'Ctrl+Shift+1', mac: 'Cmd+Ctrl+1' },
  { command: 'article-list', label: '文档列表', shortcut: '', mac: 'Cmd+Ctrl+2' },
  { command: 'files', label: '文件树', shortcut: 'Ctrl+Shift+3', mac: 'Cmd+Ctrl+3' },
  { command: 'toolbar', label: '显示工具栏', shortcut: '' },
  { command: 'statistics', label: '字数统计', shortcut: '' },
  { command: 'focus', label: '专注模式', shortcut: 'F8' },
  { command: 'typewriter', label: '打字机模式', shortcut: 'F9' },
  { command: 'zoom-in', label: '放大', shortcut: 'Ctrl+Shift+=', mac: '' },
  { command: 'zoom-out', label: '缩小', shortcut: 'Ctrl+Shift+-', mac: '' },
  { command: 'zoom-reset', label: '实际大小', shortcut: 'Ctrl+Shift+0', mac: '' },
  { command: 'next-document', label: '切换文档', shortcut: 'Ctrl+Tab', mac: 'Cmd+`' },
] as const satisfies readonly { command: AppCommand; label: string; shortcut: string; mac?: string }[]

export type ShortcutCommand = typeof SHORTCUT_DEFINITIONS[number]['command']
export type ShortcutOverrides = Partial<Record<ShortcutCommand, string>>
const definitions = new Map<string, typeof SHORTCUT_DEFINITIONS[number]>(SHORTCUT_DEFINITIONS.map(item => [item.command, item]))
const modifierAliases: Record<string, string> = { control: 'Ctrl', ctrl: 'Ctrl', command: 'Cmd', cmd: 'Cmd', meta: 'Cmd', cmdorctrl: 'CmdOrCtrl', commandorcontrol: 'CmdOrCtrl', alt: 'Alt', option: 'Alt', shift: 'Shift' }
const keyAliases: Record<string, string> = { space: 'Space', tab: 'Tab', enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right' }

export function normalizeAccelerator(input: unknown): string {
  if (typeof input !== 'string' || input.length > 80 || /[\x00-\x1f\x7f]/.test(input)) throw new Error('快捷键必须是不超过 80 个字符的组合。')
  if (!input.trim()) return ''
  const pieces = input.trim().split('+').map(piece => piece.trim())
  const rawKey = pieces.pop()!.toLowerCase()
  const key = keyAliases[rawKey] ?? (/^(?:[a-z0-9]|f(?:[1-9]|1[0-9]|2[0-4]))$/.test(rawKey) ? rawKey.toUpperCase() : /^[,.;/\\[\]`=\-]$/.test(rawKey) ? rawKey : undefined)
  if (!key) throw new Error('快捷键需要一个字母、数字、标点或 F1–F24 按键。')
  const modifiers = pieces.map(piece => modifierAliases[piece.toLowerCase()])
  if (modifiers.some(value => !value) || new Set(modifiers).size !== modifiers.length || (modifiers.includes('CmdOrCtrl') && (modifiers.includes('Cmd') || modifiers.includes('Ctrl')))) throw new Error('快捷键修饰键无效或重复。')
  if (!modifiers.some(value => value !== 'Shift') && !/^F\d+$/.test(key)) throw new Error('文字按键必须搭配 Ctrl、Cmd 或 Alt，避免影响输入。')
  return [...['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'].filter(value => modifiers.includes(value)), key].join('+')
}

function signature(accelerator: string, platform: string): string {
  const pieces = accelerator.split('+')
  const key = pieces.pop()!
  const modifiers = pieces.map(part => part === 'CmdOrCtrl' ? platform === 'darwin' ? 'Cmd' : 'Ctrl' : part)
  return [...new Set(modifiers)].sort().join('+') + '+' + key
}

export function defaultShortcut(command: AppCommand, platform: string): string | undefined {
  const definition = definitions.get(command)
  if (!definition) return undefined
  return (platform === 'darwin' && 'mac' in definition ? definition.mac : definition.shortcut) || undefined
}

export function shortcutForCommand(command: AppCommand, platform: string, overrides: ShortcutOverrides): string | undefined {
  if (Object.hasOwn(overrides, command)) return overrides[command as ShortcutCommand] || undefined
  const fallback = defaultShortcut(command, platform)
  // Older configurations may already assign the newly introduced default to another command.
  if ((command === 'article-list' || command === 'select-line' || command === 'copy-markdown' || command === 'delete-word' || command === 'delete-line' || command === 'jump-selection') && fallback && Object.entries(overrides).some(([other, shortcut]) => other !== command && shortcut && signature(shortcut, platform) === signature(fallback, platform))) return undefined
  return fallback
}

function reservedShortcuts(platform: string): Map<string, string> {
  const reservations: [string, string][] = []
  for (const key of ['X', 'C', 'V', 'A', 'Z', 'Y', 'Shift+Z', 'F']) reservations.push([`CmdOrCtrl+${key}`, '剪贴板、撤销或查找'])
  for (const key of ['B', 'I', 'K', 'T', '0', '1', '2', '3', '4', '5', '6', 'Shift+K', 'Shift+M', 'Shift+Q', 'Shift+L', 'Shift+[', 'Shift+]', 'Shift+`', '\\', '[', ']', 'U', 'Shift+U', 'G', 'Shift+G', 'D', 'Alt+G', 'Alt+\\', 'Shift+\\']) reservations.push([`CmdOrCtrl+${key}`, '编辑器固定操作'])
  reservations.push(['Alt+Shift+5', '删除线'], ['Alt+U', '选区重做'], ['F3', '查找下一个'], ['Shift+F3', '查找上一个'], ['F11', '全屏'], ['Shift+F12', '开发者工具'], ['Alt+F4', '关闭窗口'], ['Alt+Tab', '系统窗口切换'], ['Ctrl+Insert', '复制'], ['Shift+Insert', '粘贴'])
  if (platform === 'darwin') {
    reservations.push(['Cmd+Q', '退出应用'], ['Cmd+M', '最小化'], ['Cmd+H', '隐藏应用'], ['Cmd+Alt+H', '隐藏其他应用'], ['Cmd+Tab', '系统应用切换'], ['Cmd+Alt+F', '全屏'])
    for (const key of ['B', 'F', 'P', 'N', 'A', 'E', 'D', 'H', 'K', 'O', 'T', 'V', 'L']) {
      reservations.push([`Ctrl+${key}`, 'macOS 文本导航'], [`Ctrl+Shift+${key}`, 'macOS 文本选择'])
    }
  } else reservations.push(['Ctrl+M', '编辑器焦点导航'], ['Alt+L', '选择当前行'])
  return new Map(reservations.map(([shortcut, label]) => [signature(shortcut, platform), label]))
}

export function normalizeShortcutOverrides(input: unknown = {}, platform = 'win32'): ShortcutOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('快捷键配置必须是对象。')
  const result: ShortcutOverrides = {}
  for (const [command, value] of Object.entries(input)) {
    if (!definitions.has(command)) throw new Error(`不支持自定义快捷键：${command}。`)
    const shortcut = normalizeAccelerator(value)
    if (platform !== 'darwin' && shortcut.split('+').includes('Cmd')) throw new Error('当前平台请使用 Ctrl 或 CmdOrCtrl。')
    result[command as ShortcutCommand] = shortcut
  }
  const used = new Map<string, string>()
  if (platform === 'darwin' && !Object.hasOwn(result, 'quick-open')) used.set(signature('Cmd+P', platform), '快速打开')
  const reserved = reservedShortcuts(platform)
  for (const definition of SHORTCUT_DEFINITIONS) {
    const shortcut = shortcutForCommand(definition.command, platform, result)
    if (!shortcut) continue
    const key = signature(shortcut, platform)
    const existing = used.get(key)
    if (existing) throw new Error(`“${definition.label}”与“${existing}”的快捷键冲突。`)
    used.set(key, definition.label)
    if (!Object.hasOwn(result, definition.command)) continue
    const defaultKey = defaultShortcut(definition.command, platform)
    if (defaultKey && key === signature(defaultKey, platform)) continue
    const navigation = /\+(?:Up|Down|Left|Right|Home|End|PageUp|PageDown|Enter|Backspace|Delete|Escape)$/.test(key)
    if (reserved.has(key) || navigation) throw new Error(`“${definition.label}”的快捷键与${reserved.get(key) ?? '文本导航或编辑'}冲突。`)
  }
  return result
}

export interface ShortcutKeyboardEvent { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
/** Typora's macOS editor aliases, with configured shortcuts taking precedence. */
export function macTyporaShortcut(event: ShortcutKeyboardEvent, platform: string, overrides: ShortcutOverrides): ShortcutCommand | 'ordered-list' | 'bullet-list' | 'code' | null {
  if (platform !== 'darwin' || !event.metaKey || !event.altKey || event.ctrlKey || event.shiftKey || !['KeyO', 'KeyU', 'KeyC'].includes(event.code ?? '')) return null
  const key = event.code === 'KeyO' ? 'o' : event.code === 'KeyU' ? 'u' : 'c'
  return shortcutCommandForEvent({ ...event, key }, platform, overrides) ?? (key === 'o' ? 'ordered-list' : key === 'u' ? 'bullet-list' : 'code')
}

export function shortcutCommandForEvent(event: ShortcutKeyboardEvent, platform: string, overrides: ShortcutOverrides): ShortcutCommand | null {
  const punctuation: Record<string, string> = { Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Backquote: '`', Equal: '=', Minus: '-', Comma: ',', Period: '.', Semicolon: ';' }
  const raw = punctuation[event.code ?? ''] ?? (event.key === ' ' ? 'Space' : event.key)
  let accelerator: string
  try { accelerator = normalizeAccelerator([event.metaKey ? 'Cmd' : '', event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', raw].filter(Boolean).join('+')) }
  catch { return null }
  const key = signature(accelerator, platform)
  if (platform === 'darwin' && !Object.hasOwn(overrides, 'quick-open') && key === signature('Cmd+P', platform)) return 'quick-open'
  return SHORTCUT_DEFINITIONS.find(definition => {
    const shortcut = shortcutForCommand(definition.command, platform, overrides)
    return shortcut && signature(shortcut, platform) === key
  })?.command ?? null
}
