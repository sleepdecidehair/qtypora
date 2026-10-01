import { describe, expect, it } from 'vitest'
import type { AppCommand } from '../shared/contracts'
import { createMenuTemplate, type DesktopMenuItem, type MenuActions } from './menu'

function flatten(menu: DesktopMenuItem[]): DesktopMenuItem[] {
  return menu.flatMap((item) => [item, ...flatten(item.submenu ?? [])])
}

function setup(platform: NodeJS.Platform = 'win32', isPackaged = false): { items: DesktopMenuItem[]; commands: AppCommand[] } {
  const commands: AppCommand[] = []
  const actions: MenuActions = { command: (command) => commands.push(command), openRecent: () => undefined, exit: () => undefined, about: () => undefined }
  return { items: flatten(createMenuTemplate(platform, isPackaged, [], actions)), commands }
}

describe('Official Typora menu shortcuts', () => {
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
    expect(items.find((item) => item.label === '快速打开…')?.accelerator).toBe('Cmd+Shift+O')
    expect(items.find((item) => item.label === '打开文件夹…')?.accelerator).toBeUndefined()
    expect(items.find((item) => item.label === '大纲')?.accelerator).toBe('Cmd+Ctrl+1')
    expect(items.find((item) => item.label === '切换文档')?.accelerator).toBe('Cmd+`')
    const shortcuts = items.map((item) => item.accelerator).filter((value): value is string => !!value)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    expect(setup('win32', true).items.some((item) => item.role === 'toggleDevTools')).toBe(false)
  })
})
