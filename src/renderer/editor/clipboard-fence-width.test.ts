import { describe, expect, it } from 'vitest'
import { codeBlockFence, codeFenceWidth } from './clipboard-import'

describe('HTML code clipboard fence sizing', () => {
  it('finds a safe delimiter without a stack-sized argument list', () => {
    const text = '`x'.repeat(150000)
    expect(text.length).toBe(300000)
    expect(codeFenceWidth(text, 3)).toBe(3)
    expect(text.slice(0, 4)).toBe('`x`x')
  })
  it('chooses a short alternative for long delimiter runs', () => {
    expect(codeBlockFence('`'.repeat(6000000))).toBe('~~~')
    expect(codeBlockFence('~'.repeat(20))).toBe('```')
    expect(codeBlockFence('normal')).toBe('```')
  })
  it.each([['plain', 3, 3], ['`x``y', 3, 3], ['````x', 3, 5], ['a``b', 1, 3]])('sizes normal code: %s', (text, min, expected) => {
    expect(codeFenceWidth(text, min)).toBe(expected)
  })
})
