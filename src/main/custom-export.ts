import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CustomExportPreset } from '../shared/custom-export'
import { DesktopError } from './errors'
import { runConverter } from './converter-process'

/** Only explicit user preferences supply the executable/arguments, never Markdown metadata. */
export async function runCustomExport(preset: CustomExportPreset, content: string, html: string, options: { timeoutMs?: number } = {}): Promise<Buffer> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-convert-'))
  try {
    const input = path.join(root, preset.input === 'html' ? 'input.html' : 'input.md')
    const output = path.join(root, `output.${preset.extension}`)
    await fs.writeFile(input, preset.input === 'html' ? html : content, { mode: 0o600, flag: 'wx' })
    const values: Record<string, string> = { input, output, template: preset.template }
    const args = preset.args.map(arg => arg.replace(/\{(input|output|template)\}/g, (_match, key: string) => values[key]))
    await runConverter(preset.executable, args, { label: '自定义导出', cwd: root, collectOutput: false, timeoutMs: options.timeoutMs })
    const stat = await fs.lstat(output).catch(() => null)
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 64 * 1024 * 1024) throw new DesktopError('IO_ERROR', '导出程序没有生成有效文件，或结果超过 64 MB。')
    return await fs.readFile(output)
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}
