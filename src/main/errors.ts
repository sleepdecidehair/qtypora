import type { ErrorCode, Result } from '../shared/contracts'

export class DesktopError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'DesktopError'
  }
}

export function invalid(message: string): never {
  throw new DesktopError('INVALID_INPUT', message)
}

export function failure(error: unknown): Result<never> {
  if (error instanceof DesktopError) return { ok: false, error: { code: error.code, message: error.message } }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOENT') return { ok: false, error: { code: 'NOT_FOUND', message: '文件或目录不存在。' } }
  if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: { code: 'PERMISSION_DENIED', message: '没有操作此文件的权限，或文件正被其他程序占用。' } }
  if (code === 'ENOSPC') return { ok: false, error: { code: 'IO_ERROR', message: '磁盘空间不足，内容尚未保存。' } }
  if (code === 'EEXIST') return { ok: false, error: { code: 'CONFLICT', message: '目标名称已经存在。' } }
  if (code) return { ok: false, error: { code: 'IO_ERROR', message: '文件操作失败，请检查路径、磁盘及访问权限。' } }
  console.error('[desktop] Operation failed:', error instanceof Error ? error.message : 'Unknown error')
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: '操作未完成，请重试。' } }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('参数必须是对象。')
  return value as Record<string, unknown>
}

export function string(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) invalid(`${label}无效。`)
  return value
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label}必须是布尔值。`)
  return value
}
