import type { AppLocale } from '../shared/i18n'

/** Starter text is chosen only when a new empty window is created. */
export function welcomeDocument(locale: AppLocale, platform: string): string {
  if (locale === 'zh-CN') return '# 欢迎使用 QTypora\n\n默认实时预览，直接点击文字继续编辑。\n\n## 从这里开始\n\n- 按 **Ctrl + N** 新建文档\n- 按 **Ctrl + O** 打开 Markdown 文件\n- 按 **Ctrl + S** 保存\n- 按 **Ctrl + /** 在实时预览与源码模式之间切换\n- 按 **Ctrl + E** 选中当前格式范围或表格单元格\n\n> 文档保存在你的电脑上；草稿会独立恢复。\n\n```typescript\nconst message = "开始写作"\nconsole.log(message)\n```\n'
  const key = platform === 'darwin' ? '⌘' : 'Ctrl'
  return `# Welcome to QTypora\n\nLive preview is enabled by default. Click the text to edit it.\n\n## Getting started\n\n- Press **${key} + N** to create a document\n- Press **${key} + O** to open a Markdown file\n- Press **${key} + S** to save\n- Press **${key} + /** to switch between live preview and source mode\n- Press **${key} + E** to select the current formatting or table cell\n\n> Documents stay on your computer; drafts are recovered separately.\n\n\`\`\`typescript\nconst message = "Start writing"\nconsole.log(message)\n\`\`\`\n`
}
