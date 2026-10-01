# QTypora

<img src="build/icon.svg" alt="QTypora 应用图标" width="72" height="72">

QTypora 是面向 Windows 的本地 Markdown 桌面编辑器，参考 Typora 的实时预览交互。文档保存在普通 `.md` 文件中，配置和恢复草稿保存在应用用户目录。

当前提供 Windows 10 / 11 x64 内测安装包，功能仍在迭代。项目需求见 [Windows PRD](docs/Typora-Windows-完整需求文档.md)；需求中的规划项不代表已经实现或完成验收。

## Windows 内测下载

下载 [QTypora 0.1.0 Windows x64 安装程序](https://github.com/sleepdecidehair/qtypora/releases/download/v0.1.0-internal/QTypora-0.1.0-internal-x64-setup.exe)，运行后按向导选择安装目录。SHA-256 校验文件和内测公钥证书见 [Release 页面](https://github.com/sleepdecidehair/qtypora/releases/tag/v0.1.0-internal)。

这是内测自签名版本，Windows 可能显示未知发布者或 SmartScreen 提示；签名及核验方式见下方打包说明。

## 当前功能

- **Markdown 编辑**：实时预览与全篇源码切换，标题、列表、引用、行内格式、代码块和表格编辑。
- **图片与图表**：本地图片、Mermaid 图表、MathJax 数学公式；资源适应正文宽度和可见高度，支持在独立查看器中缩放和平移。
- **文档管理**：文件树、大纲、最近文档、多标签、多窗口、快速打开及工作区递归搜索。
- **本地保存**：保存、另存为、保存全部、外部修改冲突检查、恢复草稿与可选自动保存。
- **阅读与外观**：浅色、深色及跟随系统主题，正文宽度与字体设置，源码行号、自动换行、专注模式和打字机模式。
- **导出**：HTML 和 PDF 导出；图表可保存为 SVG、PNG 或 JPEG。

### 编辑模式与常用操作

| 状态 | 行为 |
| --- | --- |
| 实时预览编辑（默认） | 直接编辑内容，按位置局部显示 Markdown 语法；表格可编辑单元格，公式和图表提供块编辑入口 |
| 源码编辑 | 显示并编辑完整 Markdown 文本，与实时预览共用同一份文档 |
| 文件只读 | 根据文件的实际写入权限限制修改；它是文件状态，不是可切换的第三种编辑模式 |

按 `Ctrl+/` 切换实时预览与源码。实时预览中，双击支持局部编辑的格式化内容可展开对应源码；不局限于标题。`Ctrl+E` 选择当前样式内容或表格单元格，`Ctrl+Click` 打开链接。引用按钮再次点击可取消引用。

实时预览中，在单独一行输入三个英文反引号并按 Enter 可插入代码块；反引号后的语言名称用于语法高亮，也可通过代码块的语言选择器修改。源码模式下 Enter 按普通文本换行处理。例如：

````markdown
```javascript
console.log('Hello, QTypora')
```
````

普通图片、表格和图表在正文中居中布局，资源按可用空间等比适配，不修改原文件。图片右键选择“查看原图片”，图表和公式选择“查看资源”，可查看完整内容。`<details>` 默认折叠，带 `open` 属性时默认展开。

| Windows 快捷键 | 操作 |
| --- | --- |
| `Ctrl+N` / `Ctrl+Shift+N` | 新建文档 / 新建窗口 |
| `Ctrl+O` | 打开文档 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+W` | 关闭当前文档 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `Ctrl+P` / `Ctrl+Shift+F` | 快速打开 / 工作区搜索 |
| `Ctrl+/` | 切换源码模式 |
| `Ctrl+,` | 偏好设置 |
| `Ctrl+Shift+L` | 显示或隐藏侧栏 |
| `F8` / `F9` / `F11` | 专注模式 / 打字机模式 / 全屏 |

快捷键依据 [主进程菜单](src/main/menu.ts)，更多操作见应用菜单和右键菜单。

## 开发启动

开发环境需要 Windows、Node.js **>=22.12.0** 和 npm，版本要求及命令来自 [package.json](package.json)。安装包的使用者不需要安装 Node.js。

在项目根目录用 PowerShell 执行：

```powershell
npm ci
npm run build:icon
npm run dev
```

`npm ci` 按 [package-lock.json](package-lock.json) 安装依赖。`dev` 启动 Electron 窗口及本机开发服务；显式生成图标可兼容禁用 npm 生命周期脚本的环境。

如果依赖安装脚本被禁用，导致 `node_modules/electron/dist/electron.exe` 缺失，可手动下载 Electron 运行时后再启动：

```powershell
node node_modules/electron/install.js
```

需要通过已有系统代理下载时，可在当前终端先设置 `$env:ELECTRON_GET_USE_PROXY = '1'`。

## 检查与测试

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest 单元测试 |
| `npm run build:icon` | 从 SVG 生成 PNG / ICO |
| `npm run build` | 编译主进程、预加载和界面到 `out/`，不生成安装包 |
| `npm run test:desktop` | Playwright 真实 Electron 联调测试 |
| `npm run test:packaged` | 对指定打包程序执行桌面测试 |

完整开发检查可执行：

```powershell
npm run typecheck
npm test
npm run build:icon
npm run build
Remove-Item Env:\ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
npm run test:desktop
```

桌面测试加载编译产物，因此先执行 `build`；清除开发 URL，避免误连开发服务器。测试使用临时文档和独立用户目录，替换原生对话框的选择结果，文件读写及导出仍执行真实服务。

按修改范围运行指定测试，例如：

```powershell
npm test -- src/main/documents.test.ts
npm run test:desktop -- tests/code-fence.spec.ts
```

打包程序测试需要设置 `QTYPORA_PACKAGED_EXE` 为实际 `QTypora.exe` 的绝对路径。未设置时，普通桌面测试中的打包用例会跳过；跳过不代表通过。命令示例及验证范围见 [Windows 内测打包说明](docs/Windows-内测打包.md)。

## Windows 内测打包

依赖准备好后，统一入口为：

```powershell
npm run package:win:internal
```

使用 electron-builder 26 和 NSIS 生成 `.exe` 安装程序。构建机还需要 Windows PowerShell 和 Windows SDK 的 x64 SignTool。流程由 [打包脚本](scripts/package-internal.ps1) 和 [打包配置](electron-builder.internal.cjs) 定义，自动执行依赖核对、类型检查、单元测试、图标生成、编译、签名、资源检查、隔离的安装宏与 Shell 图标测试，以及真实打包程序测试。

每次成功构建保存在独立的 `release/<版本>-internal-x64-<时间>-<编号>/`，`release/latest.json` 指向最近成功的构建。目录包含安装包、公钥证书、`SHA256SUMS.txt`、`internal-build.json`、日志和 `win-unpacked/`。任何检查失败或构建输入变化，均不更新最新构建记录。

[build/icon.svg](build/icon.svg) 是唯一图标源。`build:icon` 生成 PNG 与七种尺寸的 ICO；应用、安装程序、快捷方式和 Markdown 文档的“打开方式”图标使用同一来源。

内测包采用本机当前用户的自签名证书及 SHA-256 签名，不附公共时间戳。私钥不可导出，分发的 `.cer` 仅含公钥；脚本不会自动添加证书信任，测试电脑可能显示未知发布者或 SmartScreen 提示。

安装程序按当前用户安装，支持选择目录，将 QTypora 注册为 `.md` 的“打开方式”候选。默认应用由用户在 Windows 中选择，安装程序不覆盖系统的默认关联。自动检查不执行完整应用的安装向导、升级或卸载；这些流程仍需在独立测试机器或虚拟机验证。

分发、签名核验、安装后测试和失败日志处理详见 [Windows 内测打包说明](docs/Windows-内测打包.md)。

## 项目结构与技术栈

技术栈依据 [package.json](package.json)：Electron 44、React 19、TypeScript 7、electron-vite 5、Vite 7、CodeMirror 6、Markdown-it、MathJax、Mermaid 和 DOMPurify。构建入口见 [electron.vite.config.ts](electron.vite.config.ts)。

| 路径 | 职责 |
| --- | --- |
| `src/main/` | 窗口、菜单、文件服务、文档状态、冲突检查、配置、草稿、资源和导出 |
| `src/preload/` | 向界面暴露固定的桌面能力接口 |
| [src/shared/contracts.ts](src/shared/contracts.ts) | 主进程与界面共用的类型、结果和事件契约 |
| `src/renderer/` | React 界面、CodeMirror 编辑器、文件树、大纲、搜索和主题 |
| `tests/` | 真实 Electron 联调测试；单元测试与源码相邻 |
| `scripts/`、`build/` | 打包、签名、检查脚本及品牌和安装资源 |
| `docs/` | 需求、调研、验证与故障复盘 |
| `out/`、`release/` | 编译产物与内测构建产物 |

Markdown 文本是唯一源模型，界面不通过渲染后的 HTML 重建文档。渲染进程通过预加载接口调用本地服务，不直接访问 Node.js；窗口启用上下文隔离和沙箱，文档 HTML、SVG 及 MathML 按现有策略净化。

## 当前边界与文档

现阶段支持 UTF-8 和 UTF-8 BOM。未修改保存保留原始字节；修改后沿用检测到的 LF / CRLF 和编码。单篇源码编辑上限为 16 MB，实时预览上限为 200,000 字符，超过预览阈值时保留源码编辑。保存全部遇到取消或失败停止；跨目录另存时提示失效的相对图片引用。

Windows 实体输入法、表格拖动排序与跨格选区、图片粘贴拖放、富文本智能粘贴，以及完整主题与导出配置仍需开发或真机验收。macOS 尚未构建或验证。

- [AGENTS.md](AGENTS.md)：编码代理的项目约定。
- [Markdown 编辑交互调研](docs/Typora-Markdown编辑交互调研与复刻规范.md)：交互设计依据。
- [右键功能调研与实现要求](docs/Typora-右键菜单调研与实现需求.md)：菜单行为与需求。
- [剩余工作与计划](docs/Windows-剩余工作与并行计划.md)、[实施计划](implementation-plan.md)：规划与待验收项。
- [开发验证记录](docs/开发验证记录.md)、[故障复盘](docs/fault-reviews/)：验证证据及已知问题记录。

历史文档反映记录时的状态；当前行为以代码、近期验证记录和对应构建的检查报告为准。

## 许可证

项目许可证尚未确定。

<!-- TODO: 在发布前确定项目许可证，并审阅依赖许可证。 -->
