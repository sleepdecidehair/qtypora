import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeDirectory } from './theme-directory'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-theme-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('theme directory', () => {
  it('lists only themes and reads the global and theme overrides in separate layers', async () => {
    await fs.writeFile(path.join(root, 'paper.css'), 'h1 { color: red }')
    await fs.writeFile(path.join(root, 'base.user.css'), 'p { color: blue }')
    await fs.writeFile(path.join(root, 'paper.user.css'), 'h1 { color: green }')
    await fs.writeFile(path.join(root, 'notes.txt'), 'ignored')
    const themes = new ThemeDirectory(root)
    expect(await themes.list()).toEqual([{ id: 'paper', name: 'paper' }])
    const theme = await themes.read('paper')
    expect(theme).toMatchObject({ css: 'h1 { color: red }', globalCss: 'p { color: blue }', overrideCss: 'h1 { color: green }' })
    await fs.writeFile(path.join(root, 'paper.user.css'), 'h1 { color: black }')
    expect((await themes.read('paper')).version).not.toBe(theme.version)
  })

  it('rejects traversal, case collisions, symlinks, invalid encoding, and excessive files', async () => {
    const themes = new ThemeDirectory(root)
    for (const id of ['../secret', 'x/y', 'x\\y', 'base.user', 'CON']) await expect(themes.read(id)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await fs.writeFile(path.join(root, 'a.css'), 'p{}')
    await fs.writeFile(path.join(root, 'A.css'), 'p{}')
    if ((await fs.readdir(root)).includes('A.css') && (await fs.readdir(root)).includes('a.css')) await expect(themes.list()).rejects.toMatchObject({ code: 'CONFLICT' })
    await fs.rm(path.join(root, 'A.css'))
    await fs.writeFile(path.join(root, 'a.css'), 'p{}')
    await fs.writeFile(path.join(root, 'bad.css'), Buffer.from([0xff]))
    await expect(themes.read('bad')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await fs.writeFile(path.join(root, 'big.css'), 'x'.repeat(40_001))
    await expect(themes.read('big')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    if (process.platform !== 'win32') {
      await fs.symlink(path.join(root, 'a.css'), path.join(root, 'link.css'))
      await expect(themes.read('link')).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await fs.symlink(path.join(root, 'a.css'), path.join(root, 'a.user.css'))
      await expect(themes.read('a')).rejects.toMatchObject({ code: 'CONFLICT' })
    }
  })

  it('rejects external and escaped resource declarations in all layers', async () => {
    const themes = new ThemeDirectory(root)
    for (const css of ['@import "https://example.com/x.css";', 'p{background:u/**/rl(https://example.com/x)}', 'p{background:image-set("https://example.com/x" 1x)}', 'p{color: \\72 ed}']) {
      await fs.writeFile(path.join(root, 'paper.css'), css)
      await expect(themes.read('paper')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    }
    await fs.writeFile(path.join(root, 'paper.css'), 'p { color: red }')
    await fs.writeFile(path.join(root, 'base.user.css'), 'p { background: url(https://example.com/x) }')
    await expect(themes.read('paper')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('bounds directory enumeration and rejects a symlinked directory', async () => {
    await Promise.all(Array.from({ length: 301 }, (_, index) => fs.writeFile(path.join(root, `item-${index}.txt`), '')))
    await expect(new ThemeDirectory(root).list()).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    if (process.platform !== 'win32') {
      const link = path.join(root, 'linked-directory')
      await fs.symlink(root, link)
      await expect(new ThemeDirectory(link).list()).rejects.toMatchObject({ code: 'CONFLICT' })
    }
  })

  it.skipIf(!existsSync('/Applications/Typora.app/Contents/Resources/TypeMark/style/themes/whitey.css'))('reads the installed Typora whitey theme without loading its resources', async () => {
    await fs.copyFile('/Applications/Typora.app/Contents/Resources/TypeMark/style/themes/whitey.css', path.join(root, 'whitey.css'))
    const result = await new ThemeDirectory(root).read('whitey')
    expect(result.css).toContain('@media')
    expect(result.css).toContain('#write')
  })
})
