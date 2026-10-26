# QTypora

<img src="build/icon.svg" alt="QTypora 应用图标" width="72" height="72">

QTypora 是面向 Windows 与 macOS 的本地 Markdown 桌面编辑器，参考 Typora 的实时预览交互。文档保存在普通 `.md` 文件中，配置和恢复草稿保存在应用用户目录。

当前提供 Windows 10 / 11 x64 内测安装包；同一源码也可在 macOS 生成 arm64、x64 两个独立内部测试 DMG。功能仍在迭代，项目需求见 [Windows PRD](docs/Typora-Windows-完整需求文档.md)；需求中的规划项不代表已经实现或完成验收。

## Windows 内测下载

下载 [QTypora 0.1.0 Windows x64 安装程序](https://github.com/sleepdecidehair/qtypora/releases/download/v0.1.0-internal/QTypora-0.1.0-internal-x64-setup.exe)，运行后按向导选择安装目录。SHA-256 校验文件和内测公钥证书见 [Release 页面](https://github.com/sleepdecidehair/qtypora/releases/tag/v0.1.0-internal)。

这是内测自签名版本，Windows 可能显示未知发布者或 SmartScreen 提示；签名及核验方式见下方打包说明。

后续每次分支推送会自动生成对应提交的安装包，新版本见 [全部 Releases](https://github.com/sleepdecidehair/qtypora/releases)。

## 当前功能

以下入口依据当前 [菜单](src/main/menu.ts)、[设置界面](src/renderer/components/PreferencesDialog.tsx) 和 [导出格式](src/shared/export-options.ts)，完整差距和验证状态见 [功能核对](docs/Typora-功能差距核对-2026-10-26.md) 与 [本轮验证记录](docs/Typora-功能补齐验证-2026-10-26.md)。

- **Markdown 编辑**：实时预览与源码切换，YAML、文内目录、Alerts、脚注、Emoji、公式和图表；扩展语法、配对和代码块显示可配置。
- **图片与表格**：多图选择、图片粘贴拖放、图片目录与尺寸、资源整理和配置式上传器；表格尺寸、行列移动和多格操作。
- **文档管理**：文件树/文章列表、排序过滤、最近/固定目录、工作区内文件移动、重命名、新建/副本的会话内撤销、多窗口和快速打开；目录搜索支持全词与 RE2 正则。
- **本地保存**：保存、另存为、保存全部、冲突检查、恢复草稿与可选自动保存，启动时可恢复最近文件或文件夹。
- **写作与外观**：大纲高亮/筛选/折叠、语义统计与阅读时间、浮动工具栏、平台拼写与字典；亮暗配色、字体、正文 CSS、专注/打字机模式及页面缩放。
- **导入导出**：HTML、无样式 HTML、PDF、长图 PNG、Markdown、系统打印和复用上次导出；其它格式通过用户安装的 Pandoc 或自定义程序转换。

### 新功能入口

| 入口 | 用途 |
| --- | --- |
| 侧栏“文件”顶部选项 | 树/文章列表、排序、隐藏/全部文件、名称通配符、固定目录；拖动文件到工作区文件夹或使用移动对话框 |
| 侧栏“搜索” | 大小写、全词、RE2 正则；点击结果打开文档并定位。RE2 不支持环视和反向引用 |
| 侧栏“大纲” / 状态栏字数 | 标题过滤、折叠、编号和当前章节；详细字数、字符、段落、选区及阅读时间 |
| 选中文字 / 右键 | 浮动格式工具栏、拼写建议及字典、图片/表格/代码块操作 |
| 偏好设置 | 按名称搜索设置，修改语法、配对、图片目录/上传器、拼写、启动策略、主题/字体/CSS、导出及应用快捷键 |
| 文件 → 更多导出格式与设置 / 导入文档 / 打印 | 选择格式、保存/应用具名预设、复用成功导出配置、调用转换程序或系统打印 |
| 帮助 | 使用帮助、环境诊断、第三方许可，以及打开官方更新与发行记录页面；不自动下载安装 |

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

| Windows / macOS 快捷键 | 操作 |
| --- | --- |
| `Ctrl/Command+N` / `Ctrl/Command+Shift+N` | 新建文档 / 新建窗口 |
| `Ctrl/Command+O` | 打开文档 |
| `Ctrl/Command+S` / `Ctrl/Command+Shift+S` | 保存 / 另存为 |
| `Ctrl/Command+W` | 关闭当前文档 |
| `Ctrl/Command+F` / `Ctrl/Command+H` | 查找 / 替换 |
| Windows `Ctrl+P`、macOS `Command+Shift+O`（兼容 `Command+P`） / `Ctrl/Command+Shift+F` | 快速打开 / 工作区搜索 |
| `Ctrl/Command+/` | 切换源码模式 |
| `Ctrl/Command+,` | 偏好设置 |
| `Ctrl/Command+Shift+L` | 显示或隐藏侧栏 |
| `F8` / `F9` / `F11` | 专注模式 / 打字机模式 / 全屏 |

表内是默认快捷键。可在偏好设置中修改、禁用或恢复应用菜单快捷键；编辑器固定键及原生剪切/复制/粘贴键保留，冲突配置会被拒绝。macOS 快速打开的默认别名随自定义或禁用一起移除。更多操作见应用菜单和右键菜单。

## Pandoc 与自定义程序

QTypora **没有内置 Pandoc**。使用 Word（DOCX）、ODT、RTF、EPUB、LaTeX、MediaWiki、RST、Textile、OPML 或 Reveal.js 导出，以及对应的文档导入前，请按 [Pandoc 官方安装说明](https://pandoc.org/installing.html) 安装，再在“偏好设置 → 导出与打印”填写可执行文件路径。留空时使用应用进程 PATH 中的 `pandoc`；macOS 从 Finder 启动时的 PATH 可能与终端不同，填写绝对路径更明确。还提供 PPTX、Beamer、GFM、CommonMark 和纯文本输出；Beamer 生成 `.tex`，没有代用户运行 LaTeX 编译器。

PDF 设置支持 A0–A6、Letter、Legal、Tabloid 和自定义尺寸、四边页边距、页眉页脚、页码及大纲书签；导出窗口可保存最多 20 个内建格式预设。

“自定义导出程序与模板”需要用户自己安装可信程序，填写绝对程序路径、输出扩展名、输入格式和逐行参数。`{input}` 是临时输入文件，`{output}` 是程序需要生成的输出文件，`{template}` 是可选的绝对模板路径。每行作为一个参数传入，不解析 Shell 命令、管道或环境变量展开。程序成功退出且输出通过检查后，应用才写入最终文件；转换失败、取消或目标被外部修改时不覆盖原有输出。上传器也需单独安装和配置，参数中的 `{files}` 展开为图片路径，标准输出每行返回一个 HTTP(S) 图片地址。

导入会创建未保存文档并保留草稿，不改写输入文件。DOCX/ODT/EPUB 的受支持内嵌图片以 data URI 保留；复杂排版和不同阅读器的格式保真仍需按文档核对。导出可安全下载文档引用的公开网络图片并内联（最多 20 张、单张 10 MB、合计 32 MB）；私网/本机地址和超限资源会被拒绝，也可先通过“编辑 → 整理并下载图片到资源目录”保存到本地。

## 开发启动

开发环境需要 Windows 或 macOS、Node.js **>=22.12.0** 和 npm，版本要求及命令来自 [package.json](package.json)。安装包的使用者不需要安装 Node.js。

在项目根目录用 PowerShell、Terminal 或其他当前平台终端执行：

```text
npm ci
npm run build:icon
npm run dev
```

`npm ci` 按 [package-lock.json](package-lock.json) 安装依赖。`dev` 启动 Electron 窗口及本机开发服务；显式生成图标可兼容禁用 npm 生命周期脚本的环境。

如果依赖安装脚本被禁用，导致 Electron 运行时缺失，可手动下载运行时后再启动：

```text
node node_modules/electron/install.js
```

需要通过已有系统代理下载时，可在当前终端先设置 `$env:ELECTRON_GET_USE_PROXY = '1'`。

## 检查与测试

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | Vitest 单元测试 |
| `npm run test:release` | 自动发布脚本的成功、失败与重试测试 |
| `npm run build:icon` | 从 SVG 生成 PNG / ICO；macOS 打包再生成应用图标 |
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

桌面测试加载编译产物，因此先执行 `build`；清除开发 URL，避免误连开发服务器。测试使用临时文档和独立用户目录，替换原生对话框的选择结果，文件读写及导出仍执行真实服务。自动化窗口默认在后台运行以隔离宿主键盘；需要人工可视检查时设置 `QTYPORA_TEST_VISIBLE=1`。桌面用例应串行运行，避免全局菜单和剪贴板相互干扰。

按修改范围运行指定测试，例如：

```powershell
npm test -- src/main/documents.test.ts
npm run test:desktop -- tests/code-fence.spec.ts
```

打包程序测试需要设置 `QTYPORA_PACKAGED_EXE` 为实际主程序的绝对路径：Windows 使用 `QTypora.exe`，macOS 使用 `.app/Contents/MacOS/QTypora Internal`。未设置时打包用例会跳过；跳过不代表通过。命令示例及验证范围见对应平台的打包说明。

## macOS 内测打包

在 Apple Silicon Mac 上统一执行：

```bash
npm run package:mac:internal
```

该命令同时生成 arm64、x64 两个独立 DMG，并验证架构、ad-hoc 签名、DMG 挂载、品牌资源、ASAR 内容及两个架构的真实打包应用。x64 启动验证需要 Rosetta。macOS 内测包未使用 Developer ID、未提交 Apple 公证，其他 Mac 首次运行可能需要在 Finder 中右键选择“打开”。完整产物、限制与核验方式见 [macOS 内测打包说明](docs/macOS-内测打包.md)。

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

### 推送后自动打包与发布

[Windows internal release 工作流](.github/workflows/windows-release.yml) 在每次分支 `push` 后于 GitHub 的 Windows 构建机运行，复用 `package:win:internal`，再由 [发布脚本](scripts/github-release.cjs) 上传安装包、SHA-256 校验文件和公钥证书。无需修改本机 Git 钩子或配置个人访问令牌。

自动版本标签为 `v<版本>-internal-<提交前12位>`，标记为预发布。上传先进入草稿，三个文件的大小和 SHA-256 全部核对后才公开；同一提交已成功发布时跳过重复打包，不覆盖已有公开版本。纯标签推送不触发此工作流。

在 [Actions](https://github.com/sleepdecidehair/qtypora/actions/workflows/windows-release.yml) 查看进度和失败日志，也可手动运行或重跑失败任务。日志附件保留 7 天。CI 在临时构建机生成自签名证书并上传配套公钥，本机私钥不参与上传。

## 项目结构与技术栈

技术栈依据 [package.json](package.json)：Electron 44、React 19、TypeScript 7、electron-vite 5、Vite 7、CodeMirror 6、Markdown-it、MathJax、Mermaid 和 DOMPurify。构建入口见 [electron.vite.config.ts](electron.vite.config.ts)。

| 路径 | 职责 |
| --- | --- |
| `src/main/` | 窗口、菜单、文件服务、文档状态、冲突检查、配置、草稿、资源和导出 |
| `src/preload/` | 向界面暴露固定的桌面能力接口 |
| [src/shared/contracts.ts](src/shared/contracts.ts) | 主进程与界面共用的类型、结果和事件契约 |
| `src/renderer/` | React 界面、CodeMirror 编辑器、文件树、大纲、搜索和主题 |
| `tests/` | 真实 Electron 联调测试；单元测试与源码相邻 |
| `scripts/`、`build/` | Windows/macOS 打包、签名、检查脚本及品牌和安装资源 |
| `docs/` | 需求、调研、验证与故障复盘 |
| `out/`、`release/` | 编译产物与内测构建产物 |

Markdown 文本是唯一源模型，界面不通过渲染后的 HTML 重建文档。渲染进程通过预加载接口调用本地服务，不直接访问 Node.js；窗口启用上下文隔离和沙箱，文档 HTML、SVG 及 MathML 按现有策略净化。

## 当前边界与文档

现阶段支持 UTF-8 和 UTF-8 BOM。未修改保存保留原始字节；修改后沿用检测到的 LF / CRLF 和编码。单篇源码编辑上限为 16 MB，实时预览上限为 200,000 字符，超过预览阈值时保留源码编辑。保存全部遇到取消或失败停止；跨目录另存时提示失效的相对图片引用。

本轮已增加表格、图片粘贴/拖放、富文本转换、主题及导出配置，但尚未完成 Typora 全量等值验收。目录移动和所有文件操作的统一撤销、macOS 系统版本历史、完整界面多语言、自动更新、主题/插件市场及自研云同步仍未实现。普通文件移动、重命名、新建和副本支持当前窗口最近 20 次操作的逆序撤销；撤销新建/副本要求磁盘内容未变，保留已打开的未保存编辑。原子保存或外部替换后会保守拒绝撤销。

工作区列表索引限制为 200 个目录、5000 个文件和 20000 个条目；目录搜索最多 1000 条结果。长图高度最多 16000 像素。自定义 CSS 仅作用正文，外部资源、`@import` 和部分布局规则会被过滤，不能视为完全兼容 Typora 主题。Windows 实体输入法、安装升级卸载、Jump List、打印机与各平台拼写词典仍需实机验收。macOS 内测包为 ad-hoc 签名且未公证，不代表正式外部分发支持。

- [AGENTS.md](AGENTS.md)：编码代理的项目约定。
- [Markdown 编辑交互调研](docs/Typora-Markdown编辑交互调研与复刻规范.md)：交互设计依据。
- [右键功能调研与实现要求](docs/Typora-右键菜单调研与实现需求.md)：菜单行为与需求。
- [剩余工作与计划](docs/Windows-剩余工作与并行计划.md)、[实施计划](implementation-plan.md)：规划与待验收项。
- [Typora 功能差距核对（2026-10-26）](docs/Typora-功能差距核对-2026-10-26.md)：本轮源码与官方能力的对照、已实现项与剩余差距。
- [导出预设文件](docs/导出预设文件.md)：JSON 交换格式、冲突处理和程序配置边界。
- [本轮功能补齐验证](docs/Typora-功能补齐验证-2026-10-26.md)：本轮变更、实际检查结果、平台待验与外部前提。
- [开发验证记录](docs/开发验证记录.md)、[故障复盘](docs/fault-reviews/)：验证证据及已知问题记录。

历史文档反映记录时的状态；当前行为以代码、近期验证记录和对应构建的检查报告为准。

## 许可证

项目许可证尚未确定；第三方开源组件的许可证不自动授予 QTypora 项目本身使用许可。

[第三方版权和许可声明](src/renderer/public/third-party-notices.txt) 保留锁定生产依赖与本地 js-sequence-diagrams 适配器的许可文本，构建时复制至 `out/renderer/third-party-notices.txt` 并随安装包分发，可从“帮助 → 第三方许可”查看。Electron/Chromium 的运行时声明随 Electron 分发，Pandoc 及用户配置的外部程序不在应用内捆绑。来源与改动说明见 [sequence 适配器说明](src/renderer/editor/vendor/sequence/README.md)。

依赖或 vendor 版本变更并按锁文件安装后，显式执行以下命令更新和核对声明；检查不代替发布前的许可证审阅：

```text
node scripts/third-party-notices.cjs
node scripts/third-party-notices.cjs --check
```

<!-- TODO: 在正式分发前确定项目许可证，并完成依赖及字体许可审阅。 -->
