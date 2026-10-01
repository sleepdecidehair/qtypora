import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingImagesAfterSaveAs } from './image-paths'

let directory: string
let original: string
let destination: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-image-paths-'))
  original = path.join(directory, 'old', 'note.md')
  destination = path.join(directory, 'new', 'note.md')
  await fs.mkdir(path.join(directory, 'old', 'assets'), { recursive: true })
  await fs.mkdir(path.join(directory, 'new', 'assets'), { recursive: true })
  await fs.writeFile(path.join(directory, 'old', 'assets', '中文 图.png'), 'image bytes')
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

describe('Image paths when changing the document directory', () => {
  it('reports real relative image references that resolve before save-as but are missing afterward', async () => {
    const source = `![图](assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png)\n\n<img src="assets/中文 图.png">`
    expect(await missingImagesAfterSaveAs(source, original, destination)).toEqual([
      'assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png', 'assets/中文 图.png',
    ])
  })

  it('does not warn for existing target images or when saving in the same directory', async () => {
    const source = '![图](assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png)'
    expect(await missingImagesAfterSaveAs(source, original, path.join(path.dirname(original), 'other.md'))).toEqual([])
    await fs.copyFile(path.join(directory, 'old', 'assets', '中文 图.png'), path.join(directory, 'new', 'assets', '中文 图.png'))
    expect(await missingImagesAfterSaveAs(source, original, destination)).toEqual([])
  })

  it('supports reference-style images and ignores URLs, already broken references, and front matter', async () => {
    const source = `---\nimage: '![图](assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png)'\n---\n\n![参考][image]\n\n[image]: assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png\n\n![远程](https://example.com/a.png)\n![缺失](already-missing.png)`
    expect(await missingImagesAfterSaveAs(source, original, destination)).toEqual(['assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png'])
    expect(await missingImagesAfterSaveAs(source, null, destination)).toEqual([])
  })
})
