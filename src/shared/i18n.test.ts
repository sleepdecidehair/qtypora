import { describe, expect, it } from 'vitest'
import { translate, translateKnownError, translateShortcutError } from './i18n'

const labels = ['文件(&F)', '编辑(&E)', '查看(&V)', '窗口(&W)', '帮助(&H)', '保存', '取消', '偏好设置']
describe('application locale lookup', () => {
  it('keeps the Chinese source and provides English text for application labels', () => {
    for (const label of labels) {
      expect(translate('zh-CN', label)).toBe(label)
      expect(translate('en-US', label)).not.toBe(label)
    }
    expect(translate('en-US', '尚未翻译的内置标签')).toBe('尚未翻译的内置标签')
    expect(translate('en-US', 'constructor')).toBe('constructor')
  })

  it('translates known validation errors without changing unknown text', () => {
    expect(translateKnownError('en-US', '文件或目录不存在。')).toBe('The file or folder does not exist.')
    expect(translateKnownError('en-US', '预设文件不是有效的 JSON。')).toBe('The preset file is not valid JSON.')
    expect(translateKnownError('zh-CN', '文件或目录不存在。')).toBe('文件或目录不存在。')
    expect(translateKnownError('en-US', '保存')).toBe('保存')
    expect(translateKnownError('en-US', '无法打开“保存”。')).toBe('无法打开“保存”。')
    expect(translateShortcutError('en-US', '快捷键修饰键无效或重复。')).toBe('Shortcut modifiers are invalid or repeated.')
    expect(translateShortcutError('en-US', '“保存”与“关闭文档”的快捷键冲突。')).toBe('The shortcuts for “Save” and “Close document” conflict.')
    expect(translateShortcutError('en-US', '“保存”的快捷键与编辑器固定操作冲突。')).toBe('The shortcut for “Save” conflicts with a fixed editor action.')
    expect(translateShortcutError('en-US', '未知输入：原样保留')).toBe('未知输入：原样保留')
    expect(translateShortcutError('en-US', '保存')).toBe('保存')
    expect(translateShortcutError('en-US', '“用户文件”与“保存”的快捷键冲突。')).toBe('“用户文件”与“保存”的快捷键冲突。')
  })
})
