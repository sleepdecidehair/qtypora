import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_OPTIONS, normalizeImageOptions } from '../shared/image-options'
import { DocumentSession } from './documents'
import { canonicalPath } from './files'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import { runImageUploader, uploadImages, uploaderUrls } from './image-uploader'

let directory: string
let documents: DocumentSession
beforeEach(async () => {
  directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-uploader-')))
  const store = new LocalStore(path.join(directory, 'user'))
  await store.load()
  documents = new DocumentSession(store, { chooseSave: async () => null, confirmClose: async () => 'discard' }, () => undefined)
})
afterEach(async () => { documents.dispose(); await fs.rm(directory, { recursive: true, force: true }) })
async function uploader(script: string) {
  const filename = path.join(directory, 'uploader.cjs')
  await fs.writeFile(filename, script)
  return { ...DEFAULT_IMAGE_OPTIONS, uploaderExecutable: process.execPath, uploaderArgs: [filename, '{files}'] }
}

describe('explicitly configured image uploader', () => {
  it('passes filenames literally without a shell and preserves returned image order', async () => {
    const options = await uploader('for (const value of process.argv.slice(2)) console.log("https://images.example/" + encodeURIComponent(value))')
    const files = ['a b.png', '$(touch should-not-exist).png']
    expect(await runImageUploader(files, options)).toEqual(files.map(value => 'https://images.example/' + encodeURIComponent(value)))
    expect(() => normalizeImageOptions({ uploaderExecutable: 'sh' })).toThrow()
    expect(() => normalizeImageOptions({ uploaderArgs: ['--files={files}'] })).toThrow()
  })
  it('rejects partial output and credential URLs without reporting private process output', async () => {
    expect(uploaderUrls('upload started\nhttps://images.example/a.png\n', 1)).toEqual(['https://images.example/a.png'])
    expect(() => uploaderUrls('https://images.example/a.png', 2)).toThrow('数量')
    expect(() => uploaderUrls('https://user:secret@images.example/a.png', 1)).toThrow('凭据')
    const options = await uploader('process.stderr.write("private-token"); process.exit(2)')
    await expect(runImageUploader(['a.png'], options)).rejects.toThrow('退出代码 2')
    await expect(runImageUploader(['a.png'], options)).rejects.not.toThrow('private-token')
  })
  it('uploads only authorized actual references including normalized spaces and HTML entities', async () => {
    const content = '![a](<a file.png>)\n\n<img src="a&amp;b.png">'
    const filename = path.join(directory, 'note.md')
    await fs.writeFile(filename, content)
    await fs.writeFile(path.join(directory, 'a file.png'), Buffer.from([137, 80, 78, 71]))
    await fs.writeFile(path.join(directory, 'a&b.png'), Buffer.from([137, 80, 78, 71]))
    const record = await documents.open(filename, true)
    const options = await uploader('process.argv.slice(2).forEach((_, index) => console.log("https://images.example/" + index + ".png"))')
    const request = { id: record.id, revision: 0, content, sources: ['a%20file.png', 'a&b.png'] }
    expect(await uploadImages(request, documents, new ResourceRegistry(), 1, options)).toEqual({ replacements: [{ source: 'a%20file.png', url: 'https://images.example/0.png' }, { source: 'a&b.png', url: 'https://images.example/1.png' }] })
    await expect(uploadImages({ ...request, sources: ['other.png'] }, documents, new ResourceRegistry(), 1, options)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(documents.get(record.id).currentContent).toBe(content)
  })
  it('does not offer replacements if the document changes while the uploader is running', async () => {
    const content = '![a](a.png)', filename = path.join(directory, 'note.md'), marker = path.join(directory, 'started')
    await fs.writeFile(filename, content)
    await fs.writeFile(path.join(directory, 'a.png'), Buffer.from([137, 80, 78, 71]))
    const record = await documents.open(filename, true)
    const options = await uploader(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready'); setTimeout(() => console.log('https://images.example/a.png'), 300)`)
    const pending = uploadImages({ id: record.id, revision: 0, content, sources: ['a.png'] }, documents, new ResourceRegistry(), 1, options)
    await expect.poll(async () => fs.readFile(marker, 'utf8').catch(() => '')).toBe('ready')
    await documents.sync({ id: record.id, revision: 1, content: content + '\nchanged' })
    await expect(pending).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
