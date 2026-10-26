import type { App, JumpListCategory } from 'electron'
import path from 'node:path'

export function windowsJumpList(executable: string): JumpListCategory[] {
  if (!path.win32.isAbsolute(executable) || /[\0\r\n]/.test(executable)) throw new Error('Windows 可执行文件路径无效。')
  return [{ type: 'tasks', items: [{ type: 'task', program: executable, args: '--new-document', title: '新建文档', description: '在新窗口中新建 Markdown 文档', iconPath: executable, iconIndex: 0 }] }, { type: 'recent' }]
}

export function configureWindowsJumpList(app: Pick<App, 'setJumpList'>, platform: NodeJS.Platform, packaged: boolean, executable: string): ReturnType<App['setJumpList']> | 'not-applicable' {
  if (platform !== 'win32' || !packaged) return 'not-applicable'
  return app.setJumpList(windowsJumpList(executable))
}

/** Call only after successfully opening or saving a document, never during list refresh. */
export function rememberSystemDocument(app: Pick<App, 'addRecentDocument'>, platform: NodeJS.Platform, packaged: boolean, filePath: string): void {
  if (!packaged || !['win32', 'darwin'].includes(platform)) return
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(filePath) || /[\0\r\n]/.test(filePath)) return
  app.addRecentDocument(filePath)
}
