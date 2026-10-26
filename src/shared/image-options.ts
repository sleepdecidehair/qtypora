import type { DocumentSnapshot } from './contracts'

export interface ImageOptions {
  directory: string
  useRelativePath: boolean
  smartPaste: boolean
  uploaderExecutable: string
  uploaderArgs: string[]
  uploadOnInsert: boolean
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = { directory: 'assets', useRelativePath: true, smartPaste: true, uploaderExecutable: '', uploaderArgs: ['{files}'], uploadOnInsert: false }

export function normalizeImageOptions(input: unknown): ImageOptions {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new Error('图片设置必须是对象。')
  const value = (input ?? {}) as Record<string, unknown>
  const directory = value.directory ?? DEFAULT_IMAGE_OPTIONS.directory
  if (typeof directory !== 'string' || !directory.trim() || directory.length > 200 || /[<>:"|?*\x00-\x1f]/.test(directory) || /^[\\/]/.test(directory) || directory.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('图片目录必须是文档目录内的相对文件夹。')
  for (const key of ['useRelativePath', 'smartPaste', 'uploadOnInsert']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('图片与粘贴设置无效。')
  }
  const executable = value.uploaderExecutable ?? ''
  if (typeof executable !== 'string' || executable.length > 4096 || /[\x00-\x1f]/.test(executable) || (executable && !/^(?:[a-z]:[\\/]|\/)/i.test(executable))) throw new Error('上传器需要可执行文件的绝对路径。')
  const args = value.uploaderArgs ?? DEFAULT_IMAGE_OPTIONS.uploaderArgs
  if (!Array.isArray(args) || args.length > 40 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\x00-\x1f]/.test(arg))) throw new Error('上传器参数必须是最多 40 个字符串的数组。')
  if (args.filter(arg => arg === '{files}').length > 1 || args.some(arg => arg.includes('{files}') && arg !== '{files}')) throw new Error('{files} 必须单独作为一个上传器参数，最多出现一次。')
  return { directory: directory.replaceAll('\\', '/'), useRelativePath: value.useRelativePath === undefined ? true : value.useRelativePath as boolean, smartPaste: value.smartPaste === undefined ? true : value.smartPaste as boolean, uploaderExecutable: executable, uploaderArgs: [...args] as string[], uploadOnInsert: value.uploadOnInsert === undefined ? false : value.uploadOnInsert as boolean }
}

export interface ImportedImage { name: string; bytes: Uint8Array }
export interface ImageImportRequest extends DocumentSnapshot { images: ImportedImage[] }
export interface ImageImportResult { markdown: string; paths: string[] }
export interface UploadImagesRequest extends DocumentSnapshot { sources: string[] }
export interface UploadImagesResult { replacements: { source: string; url: string }[] }
