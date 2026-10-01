# 桌面服务 PRD 差异核对

范围：`src/main/**`、`src/preload/**`。核对日期：2026-09-30。
此表区分代码和单元测试证据、仍待真实桌面联调的行为，以及尚未实现的 PRD 条目。不是 Typora 全量功能验收结论。

## 本轮官方逻辑纠正

[Typora 官方快捷键](https://support.typora.io/Shortcut-Keys/)明确：Ctrl+/ 切换源码模式，Ctrl+E 选择格式范围或表格单元格；F8 专注、F9 打字机；Ctrl+Shift+1 大纲、Ctrl+Shift+2 文章列表、Ctrl+Shift+3 文件树。

`src/main/menu.ts:16` 与 `src/main/menu.test.ts`：原生菜单已按实现能力映射，Ctrl+E 发 `select-scope`，没有阅读模式切换。尚无独立文章列表，因此没有伪造 Ctrl+Shift+2 入口。Ctrl+Shift+=/-/0 控制缩放，释放 Ctrl+=/-/0 给标题与正文命令；开发者工具改 Shift+F12，图片插入使用 Ctrl+Shift+I。

`src/main/preferences.ts:7`：旧 `readingMode` 迁移为 false，保留已有 `sourceMode`、主题和其他偏好；未知配置字段持久化保留。新产品没有独立 Reader 状态。普通输入框是否正确忽略正文命令仍由界面模块和真实 Electron 联调验证。

## P0 核对

| PRD | 当前证据 | 状态及边界 |
| --- | --- | --- |
| DOC-01/02/06 | `documents.ts:71` 的真实打开，`documents.ts:105` 的保存，`documents.ts:173/198` 的关闭保护；`files.test.ts`、`documents.test.ts` | 已有本地打开、保存/另存、取消、冲突和草稿保护。仅 UTF-8 文本，16 MB 上限。关闭文档和关闭窗口互斥，原生提示可取消。 |
| DOC-04 保存全部 | `menu.ts` 发送 `save-all`；DesktopApi 复用 `saveDocument` | 菜单已有；界面逐篇保存、取消和失败停止由界面模块实现并联调。未把跨窗口 Save All 当作已验证功能。 |
| IMG-06 | `resources.ts:16` 文档基准解析、图片扩展限制和 UUID 资源协议 | **部分**：HTTP/HTTPS、数据图片、授权目录内相对与绝对路径可用。文档目录/工作区以外的本地绝对图片尚需明确资源授权方案；没有放开任意本地文件读取。 |
| IMG-17/22 | `index.ts:292` 先复制成功再返回图片 Markdown；资源服务只读；没有正文删除到磁盘删除的联动 | 已有普通删除引用不删图片、复制失败不返回伪成功引用。拖放、剪贴板和批量图片策略尚未实现。 |
| IMG-21 | `image-paths.ts:35`，`index.ts:90` 另存前检查与原生继续/取消提示；`image-paths.test.ts` | 已防止普通 Markdown/HTML/reference 图片从可读变成目标目录缺失而无提示。当前保留原文引用，不自动搬图。原生提示的真实 Electron 分支待根代理联调；自定义 YAML 图片根策略仍未实现。 |
| SAF-01/03/04/07 | `documents.ts:85/105/151`，串行原子写入、版本 hash、独立 JSON 草稿，保存过程中保留更高 revision；恢复不写原稿 | 有单测覆盖新建/已命名草稿、冲突、晚保存、取消关闭、重复关闭、删除文件后的唯一内存副本。自动保存计时器由界面实现。 |
| SAF-06 | `files.ts:60/79`，同目录临时文件、fsync、提交前 hash 检查、rename | 写入失败和提交前冲突不改原文件，临时文件清理有测试。磁盘满/被占用/权限错误映射已实现，但不同 Windows/同步盘的真实故障矩阵未全部执行。 |
| SAF-08 | `documents.test.ts` 的新 Store、新 Session 恢复 | 已验证重新加载持久化草稿。真实进程强制终止与重启由根代理 E2E 验证；升级、断电和系统崩溃矩阵未完成。 |
| SAF-09 | `files.ts:30/79`，BOM、CRLF、中文 emoji、混合换行无修改保存单测 | 未修改文档原字节保留；修改后的文件按该文档 LF/CRLF 策略序列化。GBK/UTF-16 指定编码重开未实现；混合换行逐行编辑的完整 Typora 基准仍待验证。 |
| SRC-10 | `files.ts:147` 本地字面量扫描 | 不上传内容，没有高风险正则执行。最多 1000 命中、10000 节点、24 层，16 MB 单文件。正则/全词、多任务取消和工作进程扫描尚未实现。 |
| EXP-21/23/24 | `exports.ts:20`，无 YAML 命令执行；脚本关闭的隔离 PDF 窗口；原子写出；finally 销毁资源 | 只实现 HTML/PDF/Markdown。失败保留旧目标；不读取文档中的外部命令。正文与工具分离由编辑模块生成导出 HTML，真实图像/公式/图表输出由根代理联调。 |
| WIN-16 | `app.getPath('userData')`，`preferences.ts` 的 settings/drafts；测试目录只通过显式环境变量隔离 | 自有 QTypora 用户数据目录，与 Typora 隔离；旧配置的阅读字段迁移和未来未知字段保留均有测试。正式安装升级迁移未执行。 |

## 尚未完成的桌面服务功能

| 范围 | 具体缺项 | 现有实现证据 |
| --- | --- | --- |
| 文档与窗口 | DOC-05 移动/复制文档的完整资源策略；DOC-07 固定/清理最近目录；DOC-08 重开关闭文件；DOC-10 启动恢复策略；DOC-11 非 UTF-8 重开；DOC-14 多屏窗口位置恢复 | `DocumentSession` 只有 current sessions；`LocalStore.recentFiles` 只保存最多 20 个文件；窗口使用固定初始尺寸。 |
| 文件树 | FIL-01 独立文章列表；FIL-06 文件系统最近操作撤销；FIL-07 跨目录拖拽；FIL-09 创建/修改时间多排序；FIL-10~13 自定义过滤/隐藏规则；FIL-17 固定位置 | `runFileAction` 实现创建、重命名、回收站；`listDirectory` 固定目录优先自然名称排序、隐藏项和符号链接过滤。 |
| 图片 | IMG-02 多张、IMG-04/05 可配置复制/引用策略、IMG-09 YAML 根、IMG-12 图像剪贴板、IMG-14/15 搬图、IMG-16 下载远程图、UPL 上传器全组 | 当前原生单图选择后复制到 assets；无上传器或用户命令执行路径。 |
| 导出 | EXP-02/03 配置项目、EXP-04 独立主题、EXP-05 大纲、EXP-07/08 纸型/边距/页眉页脚、EXP-11 PDF 书签、EXP-13 长图、EXP-14~20 Pandoc/外部转换、自定义命令 | `printToPDF` 固定 A4，未传页眉页脚或文档书签参数。HTML/PDF 当前策略禁止远程 HTTP 图片；只有 token 本地图与 data 图片可离线输出。 |
| 打印与导入 | PRT 全组 Windows 打印；IMP 全组 Pandoc 导入 | 无 `webContents.print` 或 Pandoc 进程入口。不能把 PDF 导出算成已完成打印。 |
| 配置与系统 | SET 完整高级设置、THM 自定义 CSS/主题安装、SPL 多语言字典/用户词库、HLP 日志入口、更新/许可，以及 WIN 文件关联/安装集成 | 当前受限偏好、亮暗主题状态、英语拼写开关、自有配置/草稿已实现；未制作安装包、未签名。 |

## 检查记录

`npx vitest run src/main`：5 个文件，38 项测试通过。2026-09-30 18:42 最后一轮 `npm run typecheck` 全项目通过；界面并行修改时的 QuickOpen 参数中间态已由界面模块补齐。真实 Electron 联调仍由根代理完成，单元测试不能替代原生窗口验收。

此模块没有重启、reload 或关闭用户正在运行的 debug，也没有写用户的 Markdown 文件。所有文件服务测试使用各自 `mkdtemp` 目录。
