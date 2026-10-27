import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

describe('file tree labels', () => {
  it('translates application-owned labels without changing arbitrary file names', () => {
    expect(translate('en-US', '移动所选文件夹')).toBe('Move selected folder')
    expect(translate('en-US', '移动目标文件夹')).toBe('Move destination folder')
    expect(translate('zh-CN', '移动所选文件夹')).toBe('移动所选文件夹')
    expect(translate('en-US', '原文件夹')).toBe('原文件夹')
  })
})
