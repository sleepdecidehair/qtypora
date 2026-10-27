import { Facet } from '@codemirror/state'
import { translate, type AppLocale } from '../../shared/i18n'

export const editorLocale = Facet.define<AppLocale, AppLocale>({ combine: values => values[0] ?? 'zh-CN' })

// Translate only fixed application UI labels, never document or clipboard contents.
const english: Record<string, string> = {
  'YAML 前置信息': 'YAML front matter', '前置信息超过 64 KB，请在源码模式编辑。': 'Front matter exceeds 64 KB. Edit it in source mode.',
  'YAML 语法无效，原文已保留。': 'Invalid YAML syntax; the source has been preserved.', 'YAML 包含不支持的别名或无效数据，原文已保留。': 'YAML contains unsupported aliases or invalid data; the source has been preserved.',
  '注意': 'Note', '提示': 'Tip', '重要': 'Important', '警告': 'Warning', '小心': 'Caution',
  '文章目录': 'Table of contents', '无标题': 'Untitled', '目录条目超过当前文档的预览上限，请使用侧栏大纲查看全部标题。': 'The table of contents exceeds the preview limit. Use the sidebar outline to see all headings.',
  '文档结构超过预览上限，以下保留完整源码。请拆分文档或使用源码模式。': 'The document structure exceeds the preview limit. The complete source is shown below. Split the document or use source mode.',
  '剪贴板内容过于复杂，请使用纯文本粘贴。': 'Clipboard content is too complex. Paste as plain text.', '图片插入失败。': 'Image insertion failed.',
  '每次最多插入 20 张图片，单张不超过 16 MB，总计不超过 32 MB。': 'Insert up to 20 images at a time, at most 16 MB each and 32 MB total.',
  '拖放和粘贴文件目前只接受图片。': 'Only images can currently be dropped or pasted as files.',
  '文档已改变，未插入图片。请重新粘贴或拖放。': 'The document changed; images were not inserted. Paste or drop them again.',
  '图片已保存，文档已改变，未插入引用。请重新插入图片。': 'The images were saved, but the document changed and their references were not inserted. Insert the images again.',
  '文档已变化，未粘贴文本。': 'The document changed; text was not pasted.',
  '图片尺寸必须为 1–10000 的整数，留空表示自动。': 'Image dimensions must be integers from 1 to 10000; leave blank for automatic size.', '图片对齐方式无效。': 'Invalid image alignment.',
  '无法生成图表，请先检查图表源码。': 'Could not generate the diagram. Check its source.', '图表缺少有效尺寸。': 'The diagram has no valid dimensions.', '图表尺寸无效。': 'Invalid diagram dimensions.', '无法创建图片画布。': 'Could not create an image canvas.',
  '公式导出失败：{message}': 'Formula export failed: {message}', '图表导出失败：{message}': 'Diagram export failed: {message}', '图片导出失败：{message}': 'Image export failed: {message}', '图片导出失败（{resource}）：{message}': 'Image export failed ({resource}): {message}', '未知错误': 'Unknown error', '资源无法读取': 'Resource could not be read',
  'Markdown 文档': 'Markdown document', 'Markdown 编辑器': 'Markdown editor', '关闭提示': 'Dismiss message', '代码语言建议': 'Code language suggestions',
  '编辑': 'Edit', '编辑公式': 'Edit formula', '编辑行内公式': 'Edit inline formula', '编辑图片': 'Edit image', '编辑流程图': 'Edit diagram', '编辑此块': 'Edit block',
  '标为未完成': 'Mark as incomplete', '标为完成': 'Mark as complete', '跳转到脚注 {label}': 'Go to footnote {label}',
  '表格工具': 'Table tools', '表格第 {row} 行第 {column} 列': 'Table row {row} column {column}', '行数（含表头）': 'Rows including header', '列数': 'Columns',
  '调整尺寸': 'Resize', '上移行': 'Move row up', '下移行': 'Move row down', '左移列': 'Move column left', '右移列': 'Move column right', '清空选区': 'Clear selection',
  '表格需为 2–{rows} 行、1–{columns} 列。': 'Table must have 2–{rows} rows and 1–{columns} columns.',
  '缩小尺寸会删除超出范围的单元格，可撤销': 'Shrinking removes cells outside the new bounds; this can be undone.',
  'Alt+拖动或 Shift+点击选择多格；拖动行/列序号排序': 'Alt-drag or Shift-click to select cells; drag row or column handles to reorder.',
  '行': 'Row', '列': 'Column', '移动第 {index} 行': 'Move row {index}', '移动第 {index} 列': 'Move column {index}',
  '阅读正文查找': 'Find in reading view', '阅读查找文本': 'Search text in reading view', '普通文本（不支持正则）': 'Plain text (regular expressions are not supported)',
  '{current} / {total} 处': '{current} / {total} matches', '输入查找内容': 'Enter search text', '上一处': 'Previous match', '下一处': 'Next match',
  '上一处 · Shift+Enter': 'Previous match · Shift+Enter', '下一处 · Enter': 'Next match · Enter', '区分大小写': 'Match case',
  '关闭阅读查找': 'Close reading search', '关闭 · Esc': 'Close · Esc', '关闭': 'Close',
  '正在排版阅读视图…': 'Laying out reading view…', '当前阅读模式支持正文不超过 20 万个字符的文档（已验证的内嵌图片数据不计入）。请按 {shortcut} 返回编辑模式查看此文档。': 'Reading view supports up to 200,000 text characters (validated embedded image data is excluded). Press {shortcut} to return to the editor.',
  '阅读排版失败，请按 {shortcut} 返回编辑模式检查文档。': 'Reading view failed. Press {shortcut} to inspect the document in the editor.', 'Markdown 阅读内容': 'Markdown reading content',
  '查看资源': 'View resource', '图表': 'Diagram', '公式': 'Formula', '图片': 'Image', '缩小': 'Zoom out', '放大': 'Zoom in', '缩放比例': 'Zoom level',
  '缩小（−）': 'Zoom out (−)', '放大（+）': 'Zoom in (+)', '恢复完整展示（0）': 'Fit to window (0)', '适应窗口': 'Fit to window', '100% 原始尺寸（1）': 'Actual size (1)', '原始大小': 'Actual size',
  '关闭资源查看': 'Close resource viewer', '完整图表': 'Full diagram', '原图片': 'Original image', '资源加载失败，请关闭后检查图片路径。': 'Resource could not be loaded. Close this view and check the image path.',
  '正在加载资源…': 'Loading resource…', '滚轮放大鼠标所在位置 · 拖动查看细节 · + / − 缩放 · 0 恢复全图 · Esc 关闭': 'Scroll to zoom at the pointer · Drag to pan · + / − to zoom · 0 to fit · Esc to close',
  '图片尺寸': 'Image size', '填写显示像素，留空自动计算。原始图片文件不变。': 'Enter display pixels, or leave blank for automatic size. The original image is unchanged.',
  '宽度': 'Width', '高度': 'Height', '图片宽度': 'Image width', '图片高度': 'Image height', '自动': 'Auto', '对齐': 'Alignment', '图片对齐': 'Image alignment',
  '跟随段落': 'Follow paragraph', '靠左': 'Left', '居中': 'Center', '靠右': 'Right', '取消': 'Cancel', '应用尺寸': 'Apply size',
  '请输入 1–10000 的整数，或留空使用自动尺寸。': 'Enter an integer from 1 to 10000, or leave blank for automatic size.',
  '嵌入视频': 'Embedded video', '加载嵌入内容': 'Load embedded content', '在浏览器中打开': 'Open in browser', '音频': 'Audio', '视频': 'Video', '未指定资源': 'No resource specified',
  '媒体显示失败，请检查音频或视频路径。': 'Media could not be displayed. Check the audio or video path.',
  '公式显示失败': 'Formula unavailable', '公式显示失败，请编辑并检查公式。': 'Formula could not be displayed. Edit and check the formula.',
  '图表显示失败': 'Diagram unavailable', '图表显示失败，请编辑并检查图表语法。': 'Diagram could not be displayed. Edit and check its syntax.',
  '图片显示失败，请检查图片路径。': 'Image could not be displayed. Check the image path.',
  '文档或目标内容已变化，请重新打开右键菜单。': 'The document or target changed. Reopen the context menu.',
  '文档已变为只读，未修改原文。': 'The document is now read-only; no source was changed.',
  '当前文档没有可处理的图片引用。': 'The current document contains no eligible image references.',
  '单次最多处理 20 张不同的图片，请分批处理。': 'Process at most 20 distinct images at a time.',
  '文档已改变，未替换原文图片引用。': 'The document changed; image references were not replaced.',
  '上传器没有返回图片地址。': 'The uploader returned no image address.', '复制失败。': 'Copy failed.', '富文本复制失败。': 'Rich-text copy failed.',
  '复制内容嵌套过深，请缩小选区。': 'Copied content is nested too deeply; select a smaller range.',
  '粘贴失败。': 'Paste failed.', '富文本粘贴失败。': 'Rich-text paste failed.', '图片上传失败。': 'Image upload failed.', '图片整理失败。': 'Image organization failed.',
  '该右键操作当前不可用。': 'This context menu action is currently unavailable.', '右键操作失败，请重试。': 'The context menu action failed. Try again.',
}

export function editorText(locale: AppLocale | undefined, source: string, values?: Record<string, string | number>): string {
  const result = locale === 'en-US' ? (Object.hasOwn(english, source) ? english[source] : translate(locale, source)) : source
  return values ? result.replace(/\{([^{}]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match) : result
}
