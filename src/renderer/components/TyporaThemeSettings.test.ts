import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TyporaThemeSettings, validateThemeSelection, type TyporaThemeApi } from './TyporaThemeSettings'

function api(): TyporaThemeApi {
  return {
    listUserThemes: async () => ({ ok: true, data: [] }),
    readUserTheme: async id => ({ ok: true, data: { id, name: 'Theme', css: 'theme', globalCss: 'global', overrideCss: 'override', version: '1' } }),
    revealUserThemes: async () => ({ ok: true, data: undefined }),
  }
}

describe('Typora theme settings', () => {
  it('renders the selection, actions and supported subset', () => {
    const html = renderToStaticMarkup(createElement(TyporaThemeSettings, { api: api(), selectedId: 'missing', onChange: () => {} }))
    expect(html).toContain('Typora 主题')
    expect(html).toContain('刷新主题')
    expect(html).toContain('打开主题目录')
    expect(html).toContain('其他选择器和属性会被忽略')
    expect(html).toContain('missing')
  })
  it('validates all layers in application order before accepting a selection', async () => {
    const compile = vi.fn((_source: string) => ({ editor: '', export: '' }))
    expect(await validateThemeSelection(api(), 'theme', compile)).toBeNull()
    expect(compile.mock.calls.map(call => call[0])).toEqual(['theme', 'global', 'override'])
    compile.mockImplementation(() => { throw new Error('不支持资源') })
    expect(await validateThemeSelection(api(), 'theme', compile)).toBe('不支持资源')
  })
  it('rejects a failed read, a mismatched snapshot and thrown errors', async () => {
    const service = api()
    service.readUserTheme = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '主题已删除' } })
    expect(await validateThemeSelection(service, 'theme')).toBe('主题已删除')
    service.readUserTheme = async () => ({ ok: true, data: { id: 'other', name: '', css: '', globalCss: '', overrideCss: '', version: '' } })
    expect(await validateThemeSelection(service, 'theme')).toContain('不一致')
    service.readUserTheme = async () => { throw new Error('读取失败') }
    expect(await validateThemeSelection(service, 'theme')).toBe('读取失败')
    expect(await validateThemeSelection(service, '')).toBeNull()
  })
})
