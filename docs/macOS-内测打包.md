# macOS 内测打包

## 产物与适用范围

macOS 内测包必须在 Apple Silicon Mac 上构建，并要求已安装 Node.js >=22.12、Xcode Command Line Tools、`hdiutil` 和 Rosetta 2。统一入口：

```bash
npm ci
npm run package:mac:internal
```

仅在首次准备或依赖变化后执行 `npm ci`。打包命令从同一提交生成两个独立磁盘映像：

- `QTypora-<版本>-internal-mac-arm64.dmg`：Apple Silicon Mac。
- `QTypora-<版本>-internal-mac-x64.dmg`：Intel Mac，也在当前 Apple Silicon 构建机上通过 Rosetta 运行验证。

成功构建保存在 `release/<版本>-internal-mac-<时间>-<编号>/`，`release/latest-mac.json` 指向最近一次完整成功的 macOS 构建，不覆盖 Windows 使用的 `release/latest.json`。目录还包含：

- `SHA256SUMS.txt`：两个 DMG 的 SHA-256。
- `internal-mac-build.json`：版本、架构、工具版本、输入摘要、签名、资源及测试结果。
- `logs/`：打包流水线、单元测试、产物检查和两个架构的桌面测试记录。
- `mac*/QTypora Internal.app`：仅用于构建诊断和真实启动测试，不需要与 DMG 一起分发。

失败日志保存在 `.debug/package-runs/<时间>-<编号>/logs/`。任一架构的构建、签名、DMG 校验或真实启动测试失败，都不会更新 `latest-mac.json`。`.debug/package.lock` 拒绝并发打包；进程被强行终止时，确认没有打包进程后才可删除遗留锁文件。

## 签名与 Gatekeeper 边界

当前 macOS 内测包使用 ad-hoc 签名，未使用 Apple Developer ID，也未提交 Apple 公证。打包脚本验证 `.app` 内全部代码结构的签名，但该签名不能建立发布者身份，不能替代 Apple 公证。

从其他电脑或网络下载 DMG 后，macOS Gatekeeper 可能阻止首次双击运行。内部测试人员应先核对 SHA-256，再在 Finder 中右键应用并选择“打开”，或按团队允许的系统安全流程授权。不要关闭全局 Gatekeeper，不要把解除隔离属性写入应用或分发包。

```bash
shasum -a 256 QTypora-0.1.0-internal-mac-arm64.dmg
hdiutil verify QTypora-0.1.0-internal-mac-arm64.dmg
codesign --verify --deep --strict --verbose=2 '/Applications/QTypora Internal.app'
```

`spctl` 不接受未公证的内部包属于预期限制，不能据此把构建记录改写为“已公证”或“正式签名”。如果未来面向外部用户分发，应单独配置 Developer ID Application 证书、hardened runtime、必要 entitlements 和 Apple 公证凭据。

## 自动检查

`npm run package:mac:internal` 固定执行：

1. 核对 Node.js、锁定依赖、源码输入快照、Xcode 工具和 Rosetta。
2. 运行 TypeScript 类型检查、全部 Vitest 单元测试及 macOS 打包脚本测试。
3. 从 `build/icon.svg` 生成品牌资源并编译 Electron 三个入口。
4. 使用 electron-builder 26 分别构建 arm64、x64 DMG，并执行 ad-hoc 签名。
5. 对两个 DMG 执行 `hdiutil verify`、只读挂载和 Applications 链接检查。
6. 验证每个主程序的单一目标架构、Bundle ID、文档关联、应用图标、品牌资源、ASAR 白名单和 ad-hoc 签名。
7. 分别启动 arm64 及 Rosetta x64 的打包程序，验证离线加载、文件读写、Mermaid、MathJax、本地图片、HTML/PDF 导出和未保存关闭保护。
8. 比对打包前后输入快照，生成摘要、构建记录和成功指针。

桌面测试使用临时文档及独立 `QTYPORA_TEST_USER_DATA`，不会打开用户文档或修改用户配置。脚本不会自动安装 Rosetta、证书或系统组件；缺失时会失败并给出对应步骤名称。

## 安装与文档打开

打开与机器架构匹配的 DMG，把 `QTypora Internal.app` 拖入 Applications。应用声明 `.md`、`.markdown` 为可编辑文档，但不接管通用 `.txt` 默认应用。

Finder 双击 Markdown、把文件拖到 Dock 图标，或在应用已运行时再次打开 Markdown，都会交给当前窗口的文档打开流程。应用内部仍支持 `.txt`，可通过“打开”对话框手动选择。

macOS 使用 Command 作为主快捷键；界面会显示对应文案。Windows 继续显示并使用 Ctrl。两个平台共用相同的 Markdown、保存、草稿、IPC 和安全实现。

## 当前发布边界

现有 `.github/workflows/windows-release.yml` 仍只自动构建和发布 Windows x64 内测安装包。本轮不自动上传 macOS DMG，也不修改 GitHub Release 权限。分发 macOS 内测包时，应从同一成功目录同时提供目标 DMG 与 `SHA256SUMS.txt`，并明确它是未公证的内部版本。
