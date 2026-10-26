import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { metadataImageDirectory, readImageMetadata, resolveRootImagePath } from './image-metadata'

describe('bounded Typora image front matter', () => {
  it('reads only top-level string properties in a valid leading YAML block', () => {
    expect(readImageMetadata('---\ntypora-root-url: ./public\ntypora-copy-images-to: media\n---\n')).toEqual({ rootUrl: './public', copyImagesTo: 'media' })
    expect(readImageMetadata('text\n---\ntypora-root-url: /tmp\n---')).toEqual({})
    expect(readImageMetadata('---\ntypora-root-url: [invalid]\ntypora-copy-images-to: &a a\ncopy: *a\n---')).toEqual({})
  })
  it('maps a site-root URL inside the configured local root without granting filesystem authorization', () => {
    const document = path.resolve('/workspace/posts/note.md')
    const content = '---\ntypora-root-url: ../public\n---\n'
    expect(resolveRootImagePath('/images/a.png', document, content)).toBe(path.resolve('/workspace/public/images/a.png'))
    expect(resolveRootImagePath('images/a.png', document, content)).toBeNull()
    expect(() => resolveRootImagePath('/../../secret.png', document, content)).toThrow('根目录')
    expect(() => resolveRootImagePath('/a.png', document, '---\ntypora-root-url: https://example.com\n---\n')).toThrow('本地目录')
  })
  it('substitutes document filenames and does not let YAML enable uploader execution', () => {
    const filename = path.resolve('/workspace/note.md')
    expect(metadataImageDirectory('---\ntypora-copy-images-to: ${filename}.assets\n---\n', filename, 'assets')).toBe(path.resolve('/workspace/note.assets'))
    expect(metadataImageDirectory('---\ntypora-copy-images-to: upload\n---\n', filename, 'assets')).toBe(path.resolve('/workspace/assets'))
  })
})
