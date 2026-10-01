# Windows 桌面开发计划

用户已授权按 PRD 启动开发，完成后 debug 启动；正式打包等待用户之后授权。

## 架构与风险

Electron 44、React 19、TypeScript、electron-vite；本地服务通过受限 preload IPC 调用。
本轮为高风险：文件写入、草稿恢复、保存并发、IPC 权限与渲染不可信 Markdown。
文章主数据为普通 Markdown，配置和草稿为自有用户目录 JSON；不引入 HTTP 服务、账户或数据库。

## 本轮目标

交付可实际运行的 Windows 开发版：原生窗口和菜单、新建打开保存及另存、
草稿恢复与关闭保护、文件树和目录搜索、大纲、实时预览编辑与完整源码、Markdown 格式命令、
代码表格图片与数学图表的基础呈现、查找替换、亮暗主题、偏好、HTML/PDF 导出。
这是 PRD 的首次实现增量，不将全量 P2、商业体系或精确 Typora 像素复刻算作已完成。

## 文件职责和并行契约

| 路径 | 职责 | 所有者及依赖 |
| --- | --- | --- |
| package.json、构建配置 | 应用依赖、开发及检查命令 | 主代理 |
| src/shared/contracts.ts | DesktopApi、结果、文档和偏好唯一类型来源 | 主代理，跨模块变更先协调 |
| src/main/** | 窗口、IPC、文件、配置、草稿、菜单和导出 | 桌面服务模块 |
| src/preload/** | 仅暴露 DesktopApi 固定能力 | 桌面服务模块 |
| src/renderer/App.tsx、components/**、hooks/**、styles/** | 窗口内状态、侧栏、工具栏、偏好、恢复和反馈 | 界面模块 |
| src/renderer/editor/** | 编辑器生命周期、位置、事务、命令与预览 | 编辑模块，types.ts 由主代理维护 |
| tests/**、docs/开发验证记录.md | 真实 Electron 联调及剩余差异 | 主代理 |

模块以明确的文件所有权隔离写入；独立模块并行，契约和集成顺序进行。当前目录没有 Git 历史，
不为了并行制造未经用户请求的提交；接口及模块职责固定后再开发。

## 验收与停止条件

1. 类型检查与编译通过；文件服务有冲突、写入失败、UTF8 BOM、草稿恢复和并发相关测试。
2. 在真实 Electron 窗口测试打开、输入、格式、保存重开、主题模式和 HTML/PDF 输出。
3. 不可信文档脚本不执行，界面无 Node 权限，IPC 校验调用窗口与参数。
4. 关闭及切换文档不会无提示丢内容；保存结果不能清除保存过程中产生的新修改。
5. debug 启动后保持应用可见；本轮不运行安装包制作或签名发布命令。
6. 各语言、所有图表、上传器、Pandoc 长尾目标、商业体系及一比一实机差异继续登记。

## 编辑器原型决策

PRD 的 ProseMirror 是候选建议，原文往返与光标映射需验证。
按用户最新要求恢复 Typora 官方逻辑：默认实时预览编辑，Ctrl+/ 与全篇源码双向切换，Ctrl+E 选择当前样式范围或表格单元格。
仍以 Markdown 文本事务作为唯一源模型，保留未触及原文；段落和表格须在渲染状态直接编辑。
滚轮不触发源码展开，模式切换按当前可见段落衔接，光标、历史和阅读位置分别保留。
实现中的可视编辑差异必须登记，不声称已达 Typora 全量交互一致。

2026-09-30 第二轮由编辑器、界面、本地服务三个 Agent 并行推进，主代理维护契约与集成。
细分缺口和验收依赖见 [剩余工作与并行计划](docs/Windows-剩余工作与并行计划.md)。

同轮新增官方右键功能调研及实现：编辑器 Agent 负责对象定位、表格/资源工具和完整图片适配，
界面 Agent 负责文件/目录菜单与工作区目标，服务 Agent 负责原生 popup、剪贴板、图片事务及资源文件保存。
主 Agent 统一快照/revision 契约、真实 IPC 桌面回归、原文恢复和最终只读审计。
图片默认同时按正文宽高完整等比展示，用户接受缩小；不改原资源。
菜单事实、实现约束与差距见 [右键调研](docs/Typora-右键菜单调研与实现需求.md)。

## 已核对资料

- [electron-vite](https://electron-vite.org/guide/)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security)
- [CodeMirror 维护者仓库](https://github.com/codemirror/dev)

当前稳定 Electron 44 已无 Windows ia32 产物；本轮仅 x64 开发验证，ARM64 与 PRD 的 x86覆盖在基线冻结时另行明确，不冒充已测试架构。
