import { describe, expect, it } from 'vitest'
import type { AppCommand } from '../shared/contracts'
import { createMenuTemplate, type DesktopMenuItem, type MenuActions } from './menu'

function flatten(menu: DesktopMenuItem[]): DesktopMenuItem[] {
  return menu.flatMap((item) => [item, ...flatten(item.submenu ?? [])])
}

function setup(platform: NodeJS.Platform = 'win32', isPackaged = false): { items: DesktopMenuItem[]; commands: AppCommand[] } {
  const commands: AppCommand[] = []
  const actions: MenuActions = { command: (command) => commands.push(command), openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
  return { items: flatten(createMenuTemplate(platform, isPackaged, [], actions)), commands }
}

describe('Official Typora menu shortcuts', () => {
  it('exposes separate document list and file tree commands', () => {
    const { items, commands } = setup('darwin')
    const list = items.find(item => item.label === '文档列表')!
    const tree = items.find(item => item.label === '文件树')!
    expect(list.accelerator).toBe('Cmd+Ctrl+2')
    expect(tree.accelerator).toBe('Cmd+Ctrl+3')
    list.click?.(); tree.click?.()
    expect(commands).toEqual(['article-list', 'files'])
  })
  it('exposes the confirmed soft-break setting and dispatches its toggle', () => {
    let toggles = 0
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined, toggleSoftBreaks: () => { toggles++ } }
    const item = flatten(createMenuTemplate('darwin', false, [], actions, { softBreaks: true })).find(entry => entry.label === '保留软换行')!
    expect(item).toMatchObject({ type: 'checkbox', checked: true })
    item.click?.()
    expect(toggles).toBe(1)
  })
  it('shows the active line ending and disables conversion without an editable document', () => {
    const commands: AppCommand[] = []
    const actions: MenuActions = { command: command => commands.push(command), openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const items = flatten(createMenuTemplate('darwin', false, [], actions, { lineEnding: 'CRLF', canChangeLineEnding: true }))
    const crlf = items.find(item => item.label === 'Windows 换行符 (CRLF)')!
    const lf = items.find(item => item.label === 'Unix 换行符 (LF)')!
    expect(crlf).toMatchObject({ type: 'checkbox', checked: true, enabled: true })
    expect(lf).toMatchObject({ type: 'checkbox', checked: false, enabled: true })
    lf.click?.()
    expect(commands).toEqual(['line-ending-lf'])
    expect(flatten(createMenuTemplate('win32', false, [], actions)).find(item => item.label === 'Unix 换行符 (LF)')?.enabled).toBe(false)
  })
  it('shows the macOS spelling checkbox using the confirmed preference', () => {
    let toggles = 0
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined, toggleSpellcheck: () => { toggles++ } }
    const items = flatten(createMenuTemplate('darwin', false, [], actions, { spellcheck: true }))
    const item = items.find(entry => entry.label === '键入时检查拼写')!
    expect(item).toMatchObject({ type: 'checkbox', checked: true })
    item.click?.()
    expect(toggles).toBe(1)
    expect(flatten(createMenuTemplate('darwin', false, [], actions, { spellcheck: false })).find(entry => entry.label === '键入时检查拼写')?.checked).toBe(false)
    expect(flatten(createMenuTemplate('win32', false, [], actions)).find(entry => entry.label === '拼写和语法检查')).toBeUndefined()
  })
  it('offers page setup without changing the existing print shortcut', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { items, commands } = setup(platform)
      const setupItem = items.find(item => item.label === '页面设置…')!
      expect(setupItem.accelerator).toBeUndefined()
      expect(items.find(item => item.label === '打印…')?.accelerator).toBe('CmdOrCtrl+Shift+P')
      setupItem.click?.()
      expect(commands).toEqual(['page-setup'])
    }
  })
  it('adds Settings to the macOS application menu while registering its shortcut once', () => {
    const commands: AppCommand[] = []
    const actions: MenuActions = { command: command => commands.push(command), openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const menu = createMenuTemplate('darwin', false, [], actions)
    const application = menu[0]
    expect(application.role).toBe('appMenu')
    expect(application.submenu?.filter(item => item.role).map(item => item.role)).toEqual(['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit'])
    const settings = application.submenu?.find(item => item.label === '设置…')!
    const editSettings = flatten(menu.slice(1)).find(item => item.label === '偏好设置…')!
    expect(settings.accelerator).toBe('CmdOrCtrl+,')
    expect(editSettings.accelerator).toBeUndefined()
    settings.click?.(); editSettings.click?.()
    expect(commands).toEqual(['preferences', 'preferences'])
    const custom = flatten(createMenuTemplate('darwin', false, [], actions, { shortcuts: { preferences: 'Cmd+Alt+P' } }))
    expect(custom.filter(item => item.accelerator === 'Cmd+Alt+P')).toHaveLength(1)
    const disabled = flatten(createMenuTemplate('darwin', false, [], actions, { shortcuts: { preferences: '' } }))
    expect(disabled.find(item => item.label === '设置…')?.accelerator).toBeUndefined()
    expect(flatten(createMenuTemplate('win32', false, [], actions)).find(item => item.label === '偏好设置…')?.accelerator).toBe('CmdOrCtrl+,')
  })
  it('enables the Finder entry only for an available current file', () => {
    const commands: AppCommand[] = []
    const actions: MenuActions = { command: command => commands.push(command), openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const find = (available: boolean) => flatten(createMenuTemplate('darwin', false, [], actions, { canRevealCurrentFile: available })).find(item => item.label === '在 Finder 中显示当前文件')!
    expect(find(false).enabled).toBe(false)
    expect(find(true).enabled).toBe(true)
    find(true).click?.()
    expect(commands).toEqual(['reveal-current-file'])
    expect(flatten(createMenuTemplate('win32', false, [], actions)).some(item => item.label === '在 Finder 中显示当前文件')).toBe(false)
  })
  it('routes and reflects paragraph first-line indentation', () => {
    const commands: AppCommand[] = []
    const actions: MenuActions = { command: command => commands.push(command), openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const item = flatten(createMenuTemplate('darwin', false, [], actions, { indentFirstLine: true })).find(entry => entry.label === '段落首行缩进')!
    expect(item).toMatchObject({ type: 'checkbox', checked: true })
    item.click?.()
    expect(commands).toEqual(['indent-first-line'])
  })
  it('exposes native speech controls only on macOS', () => {
    const mac = setup('darwin').items
    expect(mac.find(item => item.label === '开始朗读')?.role).toBe('startSpeaking')
    expect(mac.find(item => item.label === '停止朗读')?.role).toBe('stopSpeaking')
    expect(setup('win32').items.find(item => item.label === '语音')).toBeUndefined()
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    expect(flatten(createMenuTemplate('darwin', false, [], actions, { locale: 'en-US' })).find(item => item.label === 'Start Speaking')?.role).toBe('startSpeaking')
  })
  it('opens the system emoji panel only from the macOS menu', () => {
    let opened = false
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined, showEmojiPanel: () => { opened = true } }
    flatten(createMenuTemplate('darwin', false, [], actions)).find(item => item.label === '表情与符号')?.click?.()
    expect(opened).toBe(true)
    expect(flatten(createMenuTemplate('win32', false, [], actions)).find(item => item.label === '表情与符号')).toBeUndefined()
    expect(flatten(createMenuTemplate('darwin', false, [], actions, { locale: 'en-US' })).find(item => item.label === 'Emoji and Symbols')).toBeDefined()
  })
  it('exposes plain text paste in the edit menu', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      let invoked = false
      const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined, pastePlain: () => { invoked = true } }
      flatten(createMenuTemplate(platform, false, [], actions)).find(item => item.label === '粘贴为纯文本')?.click?.()
      expect(invoked).toBe(true)
    }
  })
  it('routes the next and previous search commands', () => {
    const { items, commands } = setup()
    items.find(item => item.label === '查找下一个')?.click?.()
    items.find(item => item.label === '查找上一个')?.click?.()
    items.find(item => item.label === '替换下一个')?.click?.()
    expect(commands).toEqual(['find-next', 'find-previous', 'replace-next'])
  })
  it('routes the native always-on-top toggle', () => {
    const { items, commands } = setup('darwin')
    items.find(item => item.label === '窗口置顶 / 取消置顶')?.click?.()
    expect(commands).toEqual(['toggle-always-on-top'])
  })
  it('reflects the active native window state in the view menu', () => {
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const items = flatten(createMenuTemplate('darwin', false, [], actions, { alwaysOnTop: true }))
    expect(items.find(item => item.label === '窗口置顶 / 取消置顶')).toMatchObject({ type: 'checkbox', checked: true })
  })
  it('routes the status bar visibility command on both platforms', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { items, commands } = setup(platform)
      items.find(item => item.label === '显示 / 隐藏状态栏')?.click?.()
      expect(commands).toEqual(['statusbar'])
    }
  })
  it('routes Ctrl+E to scope selection and Ctrl+/ to source mode without a reader toggle', () => {
    const { items, commands } = setup()
    const selection = items.find((item) => item.accelerator === 'CmdOrCtrl+E')
    const source = items.find((item) => item.accelerator === 'CmdOrCtrl+/')
    expect(selection?.label).toContain('格式范围')
    selection?.click?.()
    source?.click?.()
    expect(commands).toEqual(['select-scope', 'source'])
    expect(items.some((item) => item.label?.includes('阅读模式'))).toBe(false)
  })

  it('keeps zoom and DevTools off heading, paragraph, and image editing shortcuts', () => {
    const { items, commands } = setup()
    const shortcuts = items.map((item) => item.accelerator)
    expect(shortcuts).not.toContain('CmdOrCtrl+=')
    expect(shortcuts).not.toContain('CmdOrCtrl+-')
    expect(shortcuts).not.toContain('CmdOrCtrl+0')
    expect(items.find((item) => item.accelerator === 'CmdOrCtrl+Shift+I')?.label).toBe('插入图片…')
    for (const shortcut of ['Ctrl+Shift+=', 'Ctrl+Shift+-', 'Ctrl+Shift+0']) items.find((item) => item.accelerator === shortcut)?.click?.()
    expect(commands).toEqual(['zoom-in', 'zoom-out', 'zoom-reset'])
    expect(items.find((item) => item.role === 'toggleDevTools')?.accelerator).toBe('Shift+F12')
  })

  it('routes save-all and insert-image to their frontend workflows without inventing a save-all shortcut', () => {
    const { items, commands } = setup()
    const saveAll = items.find((item) => item.label === '保存全部')
    expect(saveAll?.accelerator).toBeUndefined()
    saveAll?.click?.()
    items.find((item) => item.label === '插入图片…')?.click?.()
    expect(commands).toEqual(['save-all', 'insert-image'])
  })

  it('offers the implemented sidebar modes at their official shortcuts and has no fake Articles item', () => {
    const { items, commands } = setup()
    for (const shortcut of ['Ctrl+Shift+1', 'Ctrl+Shift+3', 'F8', 'F9']) items.find((item) => item.accelerator === shortcut)?.click?.()
    expect(commands).toEqual(['outline', 'files', 'focus', 'typewriter'])
    expect(items.some((item) => item.accelerator === 'Ctrl+Shift+2')).toBe(false)
    expect(items.find((item) => item.role === 'togglefullscreen')?.accelerator).toBe('F11')
  })

  it('retains documented macOS differences without duplicate accelerators', () => {
    const { items } = setup('darwin')
    expect(items.some((item) => item.role === 'appMenu')).toBe(true)
    expect(items.some((item) => item.label === '退出')).toBe(false)
    expect(items.find((item) => item.label === '快速打开…')?.accelerator).toBe('Cmd+Shift+O')
    expect(items.find((item) => item.label === '打开文件夹…')?.accelerator).toBeUndefined()
    expect(items.find((item) => item.label === '大纲')?.accelerator).toBe('Cmd+Ctrl+1')
    expect(items.find((item) => item.label === '切换文档')?.accelerator).toBe('Cmd+`')
    const shortcuts = items.map((item) => item.accelerator).filter((value): value is string => !!value)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    expect(setup('win32', true).items.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })

  it('uses native macOS window zoom and bring-to-front roles without changing other platforms', () => {
    const mac = setup('darwin').items
    expect(mac.find(item => item.role === 'zoom')).toMatchObject({ label: '缩放' })
    expect(mac.find(item => item.role === 'front')).toMatchObject({ label: '前置全部窗口' })
    expect(mac.find(item => item.label === '切换文档')?.accelerator).toBe('Cmd+`')
    const windows = setup('win32').items
    expect(windows.some(item => item.role === 'zoom' || item.role === 'front')).toBe(false)
    expect(windows.find(item => item.label === '切换文档')?.accelerator).toBe('Ctrl+Tab')
  })

  it('routes minimize all only from the macOS window menu', () => {
    let calls = 0
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => { calls++ }, exit: () => undefined, about: () => undefined }
    const mac = flatten(createMenuTemplate('darwin', false, [], actions))
    mac.find(item => item.label === '全部最小化')?.click?.()
    expect(calls).toBe(1)
    expect(flatten(createMenuTemplate('win32', false, [], actions)).some(item => item.label === '全部最小化')).toBe(false)
  })

  it('exposes native tab controls only for eligible macOS windows', () => {
    const actions: MenuActions = { command: () => undefined, openRecent: () => undefined, minimizeAll: () => undefined, exit: () => undefined, about: () => undefined }
    const roles = ['toggleTabBar', 'selectPreviousTab', 'selectNextTab', 'showAllTabs', 'moveTabToNewWindow']
    const enabled = flatten(createMenuTemplate('darwin', false, [], actions, { nativeTabsEnabled: true }))
    const disabled = flatten(createMenuTemplate('darwin', false, [], actions, { nativeTabsEnabled: false }))
    const windows = flatten(createMenuTemplate('win32', false, [], actions, { nativeTabsEnabled: true }))
    for (const role of roles) {
      expect(enabled.find(item => item.role === role)).toBeDefined()
      expect(disabled.find(item => item.role === role)).toBeUndefined()
      expect(windows.some(item => item.role === role)).toBe(false)
    }
    expect(enabled.find(item => item.label === '切换文档')?.accelerator).toBe('Cmd+`')
    for (const role of roles) expect(enabled.find(item => item.role === role)?.accelerator).toBeUndefined()
    const english = flatten(createMenuTemplate('darwin', false, [], actions, { nativeTabsEnabled: true, locale: 'en-US' }))
    expect(english.find(item => item.role === 'moveTabToNewWindow')?.label).toBe('Move Tab to New Window')
  })
})
