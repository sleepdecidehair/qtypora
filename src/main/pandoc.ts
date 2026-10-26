import path from 'node:path'
import type { ExportFormat } from '../shared/export-options'
import { DesktopError } from './errors'
import { runConverter } from './converter-process'

export const PANDOC_EXPORT_FORMATS = new Set<ExportFormat>(['docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'rst', 'textile', 'opml', 'revealjs', 'pptx', 'beamer', 'gfm', 'commonmark', 'plain'])
export const PANDOC_SOURCE_FORMATS = new Set<ExportFormat>(['gfm', 'commonmark', 'plain'])
export const PANDOC_IMPORT_FORMATS: Record<string, string> = { '.rtf': 'rtf', '.docx': 'docx', '.odt': 'odt', '.epub': 'epub', '.html': 'html', '.htm': 'html', '.tex': 'latex', '.rst': 'rst', '.textile': 'textile', '.opml': 'opml', '.wiki': 'mediawiki' }

/** The executable comes only from user preferences. Document content is stdin, never shell text. */
export function runPandoc(input: Uint8Array, from: string, to: string, executable = '', filterPath?: string): Promise<Buffer> {
  if (filterPath && (!path.isAbsolute(filterPath) || /[\0\r\n]/.test(filterPath))) return Promise.reject(new DesktopError('INVALID_INPUT', '应用内置的转换过滤器路径无效。'))
  const args = ['--sandbox', '--output', '-', '--from', from, '--to', to, '--standalone', '--wrap=none']
  // Only the application's trusted import wrapper supplies this filter, never document metadata.
  if (filterPath) args.push('--lua-filter', filterPath)
  return runConverter(executable || 'pandoc', args, { label: 'Pandoc 转换', input, startError: '无法启动 Pandoc。请安装 Pandoc，并在导出设置中填写可执行文件路径。' })
}
