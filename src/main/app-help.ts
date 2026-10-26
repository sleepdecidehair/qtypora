export interface DiagnosticInformation {
  applicationVersion: string
  platform: string
  architecture: string
  electronVersion: string
  chromiumVersion: string
  nodeVersion: string
  packaged: boolean
  spellcheckEnabled: boolean
  spellcheckLanguages: readonly string[]
}

export function helpText(platform: string): string {
  const primary = platform === 'darwin' ? '⌘' : 'Ctrl'
  return [
    '写作与保存',
    `${primary}+N 新建；${primary}+O 打开；${primary}+S 保存；${primary}+Shift+S 另存为。文件菜单提供保存全部、导入、导出和打印。`,
    '', 'Markdown 编辑',
    `${primary}+/ 切换源码与实时预览；${primary}+B 加粗；${primary}+I 斜体；右键打开格式、表格和资源操作。`,
    `${primary}+F 查找；${primary}+H 替换。选中文字后可以使用浮动工具栏。`,
    '', '文件与导航',
    '侧栏提供大纲、文件树、文章列表和目录搜索。文件视图可以排序、筛选、固定目录，并在工作区内拖动文件到文件夹。文件操作撤销仅作用于当前窗口的普通文件移动、重命名、新建和副本记录；文件已修改时可能拒绝撤销。',
    '目录搜索支持大小写、全词和 RE2 正则表达式。正则不支持回溯引用或环视。状态栏的字数按钮展开详细统计。',
    '', '偏好与恢复',
    `${primary}+, 打开偏好设置，调整 Markdown、图片、主题、阅读速度、拼写和启动方式。文件菜单的“恢复草稿”可检查未保存内容。`,
    '移动、导出和保存遇到冲突或取消时，请先检查提示。外部转换格式需要本机安装 Pandoc；平台拼写词典可能需要首次下载。',
  ].join('\n')
}

/** Diagnostics deliberately exclude document contents, names, paths and environment variables. */
export function diagnosticsText(input: DiagnosticInformation): string {
  return [
    `QTypora ${input.applicationVersion}`,
    `平台：${input.platform} ${input.architecture}`,
    `发行模式：${input.packaged ? '已打包' : '开发环境'}`,
    `Electron：${input.electronVersion}`,
    `Chromium：${input.chromiumVersion}`,
    `Node.js：${input.nodeVersion}`,
    `拼写检查：${input.spellcheckEnabled ? '开启' : '关闭'}`,
    `拼写语言：${input.platform === 'darwin' ? '由 macOS 自动识别' : input.spellcheckLanguages.join(', ') || '未配置'}`,
  ].join('\n')
}
