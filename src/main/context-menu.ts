import type { BrowserWindow, Menu } from 'electron'
import type { ContextMenuAction, ContextMenuKind, ContextMenuRequest } from '../shared/contracts'
import { boolean, invalid, object } from './errors'
import type { DesktopMenuItem } from './menu'

type MenuGroup = ReadonlyArray<readonly [ContextMenuAction, string]>
const editing: MenuGroup = [
  ['undo', '撤销'], ['redo', '重做'], ['cut', '剪切'], ['copy', '复制'], ['paste', '粘贴'], ['select-all', '全选'],
]
const copying: MenuGroup = [['copy-markdown', '复制为 Markdown'], ['copy-html', '复制为 HTML'], ['copy-plain', '复制为纯文本'], ['paste-plain', '粘贴为纯文本']]
const inline: MenuGroup = [['bold', '加粗'], ['italic', '斜体'], ['strike', '删除线'], ['inline-code', '行内代码'], ['clear-format', '清除格式']]
const blocks: MenuGroup = [
  ['heading-1', '一级标题'], ['heading-2', '二级标题'], ['heading-3', '三级标题'], ['heading-4', '四级标题'], ['heading-5', '五级标题'], ['heading-6', '六级标题'],
  ['paragraph', '段落'], ['quote', '引用'], ['ordered-list', '有序列表'], ['bullet-list', '无序列表'], ['task-list', '任务列表'],
  ['code', '代码块'], ['math', '数学公式'], ['horizontal-rule', '分隔线'],
]
const inserts: MenuGroup = [['table', '表格'], ['link', '链接'], ['insert-image', '图片']]
const tables: MenuGroup = [
  ['table-row-before', '在上方插入行'], ['table-row-after', '在下方插入行'], ['table-row-delete', '删除行'],
  ['table-column-before', '在左侧插入列'], ['table-column-after', '在右侧插入列'], ['table-column-delete', '删除列'],
  ['table-align-left', '左对齐'], ['table-align-center', '居中'], ['table-align-right', '右对齐'], ['copy-table', '复制表格'], ['table-delete', '删除表格'],
]
const code: MenuGroup = [['edit-block', '编辑代码块'], ['copy-code', '复制代码内容'], ['indent-code', '自动缩进']]
const math: MenuGroup = [['edit-block', '编辑公式'], ['copy-math', '复制公式源码'], ['copy-mathml', '复制 MathML']]
const diagrams: MenuGroup = [['edit-block', '编辑图表源码'], ['copy-diagram', '复制图表源码']]
const resources: MenuGroup = [['resource-save-svg', '保存为 SVG'], ['resource-save-png', '保存为 PNG'], ['resource-save-jpeg', '保存为 JPEG'], ['view-resource', '查看资源']]
const images: MenuGroup = [['view-resource', '查看原图片'], ['image-copy-path', '复制图片地址'], ['image-copy', '复制图片到…'], ['image-move', '移动 / 重命名图片…'], ['image-save-as', '图片另存为…'], ['image-remove', '移除图片引用'], ['image-delete', '删除图片（原文件及引用）…']]
const links: MenuGroup = [['open-link', '打开链接'], ['copy-link', '复制链接地址']]
const files: MenuGroup = [['file-open', '打开'], ['file-new-window', '在新窗口打开'], ['file-new-file', '新建文件…'], ['file-new-folder', '新建文件夹…'], ['file-duplicate', '创建副本'], ['file-rename', '重命名…'], ['file-trash', '移到回收站…'], ['file-copy-path', '复制路径'], ['file-reveal', '在文件管理器中显示'], ['file-refresh', '刷新']]
const groupsByKind: Record<ContextMenuKind, MenuGroup[]> = {
  editor: [editing, copying, inline, blocks, inserts], table: [tables, editing, copying, inline, blocks, inserts],
  code: [code, editing, copying, inline, blocks, inserts], math: [math, resources, editing, copying],
  diagram: [diagrams, resources, editing, copying], image: [images, editing, copying], link: [links, editing, copying, inline],
  file: [files], folder: [files.filter(([action]) => action !== 'file-duplicate')],
}
const knownActions = new Set(Object.values(groupsByKind).flat(2).filter((entry): entry is readonly [ContextMenuAction, string] => Array.isArray(entry)).map(([action]) => action))
const readonlyActions = new Set<ContextMenuAction>([
  'copy', 'select-all', 'copy-markdown', 'copy-html', 'copy-plain', 'copy-table', 'copy-code', 'copy-math', 'copy-mathml', 'copy-diagram',
  'open-link', 'copy-link', 'image-copy-path', 'image-save-as', 'resource-save-svg', 'resource-save-png', 'resource-save-jpeg', 'view-resource',
  ...files.map(([action]) => action),
])
const selectionActions = new Set<ContextMenuAction>(['cut', 'copy', 'copy-markdown', 'copy-html', 'copy-plain'])
const localImageActions = new Set<ContextMenuAction>(['image-copy', 'image-move', 'image-save-as', 'image-delete'])

export function validateContextMenu(value: unknown): ContextMenuRequest {
  const input = object(value)
  if (typeof input.kind !== 'string' || !Object.hasOwn(groupsByKind, input.kind)) invalid('右键菜单类型无效。')
  if (!Array.isArray(input.availableActions) || input.availableActions.length > 100 || input.availableActions.some((action) => typeof action !== 'string' || !knownActions.has(action as ContextMenuAction))) invalid('右键菜单操作无效。')
  return {
    kind: input.kind as ContextMenuKind, readOnly: boolean(input.readOnly, '只读状态'), hasSelection: boolean(input.hasSelection, '选区状态'),
    availableActions: [...new Set(input.availableActions)] as ContextMenuAction[],
    hasLocalResource: input.hasLocalResource === undefined ? false : boolean(input.hasLocalResource, '本地图片状态'),
    canUndo: input.canUndo === undefined ? false : boolean(input.canUndo, '撤销状态'),
    canRedo: input.canRedo === undefined ? false : boolean(input.canRedo, '重做状态'),
  }
}

export function contextMenuTemplate(request: ContextMenuRequest, select: (action: ContextMenuAction) => void): DesktopMenuItem[] {
  const available = new Set(request.availableActions)
  const result: DesktopMenuItem[] = []
  for (const group of groupsByKind[request.kind]) {
    const items = group.filter(([action]) => available.has(action) && (!request.readOnly || readonlyActions.has(action)) &&
      (!selectionActions.has(action) || request.hasSelection) && (!localImageActions.has(action) || request.hasLocalResource) &&
      (action !== 'undo' || request.canUndo) && (action !== 'redo' || request.canRedo))
      .map(([action, label]): DesktopMenuItem => ({ id: action, label, click: () => select(action) }))
    if (items.length) {
      if (result.length) result.push({ type: 'separator' })
      const label = group === copying ? '复制 / 粘贴为' : group === inline ? '格式' : group === blocks ? '段落' : group === inserts ? '插入' : null
      result.push(...(label ? [{ label, submenu: items }] : items))
    }
  }
  return result
}

interface PopupWindow {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'closed', callback: () => void): unknown
  removeListener(event: 'closed', callback: () => void): unknown
}
type PopupMenu = Pick<Menu, 'popup' | 'closePopup'>
interface PendingMenu { menu: PopupMenu; finish: (action: ContextMenuAction | null) => void }

/** A window owns at most one pending popup; closing or replacing it settles its IPC. */
export class NativeContextMenus {
  private readonly pending = new Map<number, PendingMenu>()
  constructor(private readonly create: (template: DesktopMenuItem[]) => PopupMenu) {}

  show(window: PopupWindow, request: ContextMenuRequest): Promise<ContextMenuAction | null> {
    this.cancel(window)
    if (window.isDestroyed()) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      let settled = false
      let pending: PendingMenu | undefined
      const closed = (): void => finish(null)
      const finish = (action: ContextMenuAction | null): void => {
        if (settled) return
        settled = true
        window.removeListener('closed', closed)
        if (this.pending.get(window.id) === pending) this.pending.delete(window.id)
        resolve(action)
      }
      try {
        const template = contextMenuTemplate(request, finish)
        if (!template.length) { finish(null); return }
        const menu = this.create(template)
        pending = { menu, finish }
        this.pending.set(window.id, pending)
        window.once('closed', closed)
        menu.popup({ window: window as BrowserWindow, callback: () => finish(null) })
      } catch (error) {
        if (!settled) {
          settled = true
          window.removeListener('closed', closed)
          if (this.pending.get(window.id) === pending) this.pending.delete(window.id)
          reject(error)
        }
      }
    })
  }

  cancel(window: PopupWindow): void {
    const pending = this.pending.get(window.id)
    if (!pending) return
    pending.finish(null)
    try { pending.menu.closePopup(window as BrowserWindow) } catch { /* The native window may already be destroyed. */ }
  }
}
