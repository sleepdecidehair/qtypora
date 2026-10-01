import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SearchHighlight } from './SearchHighlight'

const render = (text: string, query: string, caseSensitive = false, excerpt = false) => renderToStaticMarkup(createElement(SearchHighlight, { text, query, caseSensitive, excerpt }))

describe('search result highlighting', () => {
  it('highlights every literal match and follows the case option', () => {
    const insensitive = render('Word word WORD', 'word')
    expect(insensitive.match(/<mark /g)).toHaveLength(3)
    const sensitive = render('Word word WORD', 'word', true)
    expect(sensitive).toBe('Word <mark class="search-result-match">word</mark> WORD')
    expect(render('x.*y', '.*')).toBe('x<mark class="search-result-match">.*</mark>y')
  })

  it('keeps a match near the start of a long excerpt', () => {
    const result = render(`${'前文'.repeat(100)}002｜沃尔玛`, '002', false, true)
    expect(result).toBe(`…${'前文'.repeat(6)}<mark class="search-result-match">002</mark>｜沃尔玛`)
    expect(render('aaaa😊bbbbbbbbbbb002', '002', false, true)).toBe('…😊bbbbbbbbbbb<mark class="search-result-match">002</mark>')
  })

  it('renders file contents as escaped text and removes marks for an empty query', () => {
    const text = '<img onerror="alert(1)">'
    const result = render(text, 'onerror')
    expect(result).toContain('&lt;img <mark class="search-result-match">onerror</mark>')
    expect(result).not.toContain('<img')
    expect(render('002', '')).toBe('002')
  })
})
