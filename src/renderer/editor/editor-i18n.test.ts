import { describe, expect, it } from 'vitest'
import { editorText } from './editor-i18n'

describe('editor UI localization', () => {
  it('translates only fixed labels, retaining document values verbatim', () => {
    expect(editorText('en-US', '表格第 {row} 行第 {column} 列', { row: 2, column: 3 })).toBe('Table row 2 column 3')
    expect(editorText('zh-CN', '表格第 {row} 行第 {column} 列', { row: 2, column: 3 })).toBe('表格第 2 行第 3 列')
    expect(editorText('en-US', '跳转到脚注 {label}', { label: '$&原文' })).toBe('Go to footnote $&原文')
    expect(editorText('en-US', '用户原文')).toBe('用户原文')
  })

  it('does not treat object prototype properties as translations or interpolation values', () => {
    for (const text of ['constructor', 'toString', '__proto__']) {
      expect(editorText('en-US', text)).toBe(text)
      expect(editorText('en-US', text, { label: 'value' })).toBe(text)
    }
    expect(editorText('en-US', '{constructor} {missing}', {})).toBe('{constructor} {missing}')
  })

  it('inserts user text literally without expanding placeholders inside it', () => {
    const values = { resource: '{message}/$&.png', message: '原样错误 {resource}' }
    expect(editorText('en-US', '图片导出失败（{resource}）：{message}', values)).toBe('Image export failed ({message}/$&.png): 原样错误 {resource}')
    expect(editorText('zh-CN', '图片导出失败（{resource}）：{message}', values)).toBe('图片导出失败（{message}/$&.png）：原样错误 {resource}')
    expect(editorText('en-US', '{x} {x} {unknown}', { x: 0 })).toBe('0 0 {unknown}')
  })
})
