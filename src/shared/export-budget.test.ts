import { describe, expect, it, vi } from 'vitest'
import { base64DataUrlLength, ExportBudget, inlineResourceImages, prepareExportImages } from './export-budget'

describe('export image allocation and output budget', () => {
  it('rejects three 10 MB local references before base64 encoding and reads the local file once', async () => {
    const resolve = vi.fn(async () => 'qtypora-media://resource/abc')
    const encode = vi.fn()
    const load = vi.fn(async (_source: string, reserve: (length: number) => void) => {
      reserve(base64DataUrlLength(10 * 1024 * 1024, 'image/png'))
      encode()
      return 'unused'
    })
    await expect(prepareExportImages(['photo.png', 'photo.png', './photo.png'], resolve, load, new ExportBudget(200))).rejects.toThrow('24 MB')
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(1)
    expect(encode).not.toHaveBeenCalled()
  })
  it('counts repeated data and downloaded images rather than unique URLs and permits a bounded mixed document', async () => {
    const sources = ['data:image/png;base64,AAAA', 'remote.png', 'remote.png']
    const resolve = vi.fn(async (source: string) => source === 'remote.png' ? 'data:image/png;base64,BBBB' : source)
    const load = vi.fn(async (source: string, reserve: (length: number) => void) => { reserve(source.length); return source })
    const total = 100 + sources.reduce((sum, source) => sum + (source === 'remote.png' ? 26 : source.length), 0)
    const output = await prepareExportImages(sources, resolve, load, new ExportBudget(100, total))
    expect(output.get('remote.png')).toBe('data:image/png;base64,BBBB')
    expect(load).toHaveBeenCalledTimes(2)
    await expect(prepareExportImages(sources, resolve, load, new ExportBudget(100, 150))).rejects.toThrow('24 MB')
  })
  it('bounds main-process replacements before expansion, including multiple occurrences and existing data URIs', async () => {
    const url = 'qtypora-media://resource/abc'
    const html = `<img src="${url}"><img src="${url}"><img src="data:image/png;base64,AAAA">`
    const load = vi.fn(async () => 'data:image/png;base64,' + 'A'.repeat(100))
    await expect(inlineResourceImages(html, load, 200)).rejects.toThrow('24 MB')
    expect(load).toHaveBeenCalledTimes(1)
    const output = await inlineResourceImages(html, load, 400)
    expect(output.match(/A{100}/g)).toHaveLength(2)
    expect(output).toContain('data:image/png;base64,AAAA')
  })
})
