import { describe, expect, it } from 'vitest'
import { countWords, writingStatistics } from './wordStatistics'

describe('writing statistics', () => {
  it('counts prose without formatting, link destinations or front matter', () => {
    const content = '---\ntitle: metadata excluded\n---\n\n# 中文标题\n\nA **bright** [day](https://example.com/extra/words).\n\n[toc]\n'
    const stats = writingStatistics(content)
    expect(stats.words).toBe(7)
    expect(stats.characters).toBe(Array.from(content).length)
    expect(stats.readingMinutes).toBe(1)
  })
  it('counts Chinese beyond the BMP and keeps internal word punctuation', () => {
    expect(countWords('中文𠀀 hello-world don’t 42 😊')).toBe(6)
    expect(writingStatistics('').readingMinutes).toBe(0)
    expect(writingStatistics('word '.repeat(601), 300).readingMinutes).toBe(3)
  })
  it('counts visible code and text but excludes HTML comments and invisible scripts', () => {
    expect(writingStatistics('Text\n\n<!-- hidden comment -->\n\n<script>hidden code</script>\n\n`const value`').words).toBe(3)
    expect(writingStatistics('Visible <script>hidden words</script> end.').words).toBe(2)
    expect(writingStatistics('<p>First &mdash; second &eacute;lan.</p>').words).toBe(3)
  })
})
