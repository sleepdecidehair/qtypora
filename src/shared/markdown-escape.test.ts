import { expect, it } from 'vitest'
import { unsafeMarkdownCharacterBoundary } from './markdown-escape'

it('accepts line boundaries without relaxing protection inside long lines', () => {
  const line = 'a'.repeat(100001)
  const source = `before\n${line}\nafter`
  const start = 'before\n'.length, end = start + line.length
  expect(unsafeMarkdownCharacterBoundary(source, start)).toBe(false)
  expect(unsafeMarkdownCharacterBoundary(source, end)).toBe(false)
  expect(unsafeMarkdownCharacterBoundary(source, start + 1)).toBe(true)
  expect(unsafeMarkdownCharacterBoundary('x&amp;y', 3)).toBe(true)
  expect(unsafeMarkdownCharacterBoundary('x👩‍💻y', 3)).toBe(true)
})
