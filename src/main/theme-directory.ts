import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DesktopError } from './errors'
import { readFileSnapshot } from './file-snapshot'
import { allowsThemeCss } from '../shared/theme-css-policy'

const MAX_THEMES = 100
const MAX_CSS_BYTES = 40_000

export interface ThemeFile { id: string; name: string }
export interface ThemeSnapshot extends ThemeFile { css: string; globalCss: string; overrideCss: string; version: string }

export function validThemeId(id: string): boolean {
  return id.length > 0 && id.length <= 120 && id !== '.' && id !== '..' && !/[\\/\x00-\x1f\x7f:]/.test(id) && !/[. ]$/.test(id) && !/\.user$/i.test(id) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)
}

/** Only paths supplied by the trusted main process may construct a directory. */
export class ThemeDirectory {
  constructor(private readonly directory: string) {
    if (!path.isAbsolute(directory)) throw new DesktopError('INVALID_INPUT', '主题目录必须是绝对路径。')
  }

  private async directoryIdentity(): Promise<{ dev: number; ino: number }> {
    const stat = await fs.lstat(this.directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DesktopError('CONFLICT', '主题目录不可用或已被替换。')
    return { dev: stat.dev, ino: stat.ino }
  }

  private async verifyDirectory(identity: { dev: number; ino: number }): Promise<void> {
    const current = await this.directoryIdentity()
    if (identity.dev !== current.dev || identity.ino !== current.ino) throw new DesktopError('CONFLICT', '主题目录在读取期间发生变化。')
  }

  async list(): Promise<ThemeFile[]> {
    const identity = await this.directoryIdentity()
    const themes: string[] = []
    let count = 0
    const directory = await fs.opendir(this.directory)
    for await (const entry of directory) {
      if (++count > MAX_THEMES * 3) throw new DesktopError('UNSUPPORTED', '主题目录包含过多文件。')
      if (entry.isFile() && entry.name.endsWith('.css')) {
        const id = entry.name.slice(0, -4)
        if (validThemeId(id)) themes.push(id)
      }
    }
    if (themes.length > MAX_THEMES) throw new DesktopError('UNSUPPORTED', '主题数量超过上限。')
    const folded = new Set<string>()
    for (const id of themes) {
      const key = id.normalize('NFC').toLowerCase()
      if (folded.has(key)) throw new DesktopError('CONFLICT', '主题名称存在大小写或 Unicode 冲突。')
      folded.add(key)
    }
    await this.verifyDirectory(identity)
    return themes.sort((a, b) => a.localeCompare(b)).map(id => ({ id, name: id }))
  }

  private async readCss(filename: string, optional: boolean): Promise<string> {
    const file = path.join(this.directory, filename)
    try {
      const before = await fs.lstat(file)
      if (!before.isFile() || before.isSymbolicLink()) throw new DesktopError('CONFLICT', '主题文件不是安全的普通文件。')
      const { bytes } = await readFileSnapshot(file, MAX_CSS_BYTES, before)
      let css: string
      try { css = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      catch { throw new DesktopError('UNSUPPORTED', '主题文件必须使用 UTF-8。') }
      if (css.includes('\0')) throw new DesktopError('UNSUPPORTED', '主题文件包含二进制内容。')
      // Do not interpret CSS here. The renderer must still use its scoped CSS policy.
      // Reject escapes and resource-bearing constructs before returning any text.
      if (!allowsThemeCss(css)) throw new DesktopError('UNSUPPORTED', '主题包含不支持的资源或 CSS 规则。')
      return css
    } catch (error) {
      if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return ''
      throw error
    }
  }

  async read(id: string): Promise<ThemeSnapshot> {
    if (!validThemeId(id)) throw new DesktopError('INVALID_INPUT', '主题名称无效。')
    const identity = await this.directoryIdentity()
    const themes = await this.list()
    if (!themes.some(theme => theme.id === id)) throw new DesktopError('NOT_FOUND', '主题不存在。')
    const css = await this.readCss(`${id}.css`, false)
    const globalCss = await this.readCss('base.user.css', true)
    const overrideCss = await this.readCss(`${id}.user.css`, true)
    await this.verifyDirectory(identity)
    const version = createHash('sha256').update(JSON.stringify([id, css, globalCss, overrideCss])).digest('hex')
    return { id, name: id, css, globalCss, overrideCss, version }
  }
}
