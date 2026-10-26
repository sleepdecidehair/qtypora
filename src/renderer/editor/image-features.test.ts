import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { imageContextTarget, sourceContextTarget } from './context-target'
import { currentImageSize, imageSizeEdit } from './image-size'
import { imageAddressRanges } from './image-upload'

const state = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })

describe('source-based image size and bulk address operations', () => {
  it('sizes a reference image without changing its definition or other references', () => {
    const doc = '![first][picture] ![second][picture]\n\n[picture]: <a file.png> "caption"'
    const target = imageContextTarget(state(doc), 'a%20file.png', 0, doc.indexOf('\n'))!
    expect(target.source).toBe('![first][picture]')
    expect(doc.slice(target.address!.from, target.address!.to)).toBe('a file.png')
    expect(state(doc).update({ changes: imageSizeEdit(target, { width: 60, height: null })! }).state.doc.toString()).toBe('<img src="a%20file.png" alt="first" title="caption" width="60"> ![second][picture]\n\n[picture]: <a file.png> "caption"')
  })
  it('sets dimensions only on the selected Markdown image and preserves alt/title', () => {
    const doc = 'before ![a & b](a.png "a title") after ![other](b.png)'
    const target = sourceContextTarget(state(doc), doc.indexOf('a.png'))
    const edit = imageSizeEdit(target, { width: 320, height: null })!
    expect(state(doc).update({ changes: edit }).state.doc.toString()).toBe('before <img src="a.png" alt="a &amp; b" title="a title" width="320"> after ![other](b.png)')
    expect(() => imageSizeEdit(target, { width: 10001, height: null })).toThrow()
  })
  it('updates HTML dimensions while preserving other attributes and allows automatic size', () => {
    const doc = '<img class="kept" src="a.png" width="20" height="30" alt="A">'
    const target = imageContextTarget(state(doc), 'a.png', 0, doc.length)!
    expect(currentImageSize(doc)).toEqual({ width: 20, height: 30 })
    expect(imageSizeEdit(target, { width: 50, height: null })?.insert).toBe('<img class="kept" src="a.png" alt="A" width="50">')
    expect(imageSizeEdit(target, { width: null, height: null, alignment: 'right' })?.insert).toBe('<img class="kept" src="a.png" alt="A" align="right">')
    expect(currentImageSize('<img src="a.png" align="center">')).toEqual({ width: null, height: null, alignment: 'center' })
  })
  it('finds local inline, reference and HTML addresses while ignoring code and unused definitions', () => {
    const doc = '![inline](<a file.png>) ![remote](https://example.com/r.png)\n\n![reference][pic]\n\n[pic]: b.png "title"\n[unused]: ignored.png\n\n<img src="c&amp;d.png" width="20">\n\n`![ignored](inline.png)`\n\n```md\n![ignored](fenced.png)\n```'
    const ranges = imageAddressRanges(state(doc))
    expect(ranges.map(range => range.source)).toEqual(['a%20file.png', 'b.png', 'c&d.png'])
    expect(ranges.map(range => doc.slice(range.from, range.to))).toEqual(['a file.png', 'b.png', 'c&amp;d.png'])
    const next = state(doc).update({ changes: ranges.map((range, index) => ({ from: range.from, to: range.to, insert: `https://images.example/${index}.png` })) }).state.doc.toString()
    expect(next).toContain('[pic]: https://images.example/1.png "title"')
    expect(next).toContain('[unused]: ignored.png')
    expect(next).toContain('![ignored](fenced.png)')
  })
  it('excludes YAML with an ellipsis terminator and images in HTML comments', () => {
    const doc = '---\nnote: "![metadata](not-an-image.png)"\n...\n\n![visible](visible.png)\n\n<!-- <img src="comment.png"> -->'
    expect(imageAddressRanges(state(doc)).map(range => range.source)).toEqual(['visible.png'])
  })
})
