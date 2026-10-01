# Windows 内测打包

## 产物与适用范围

当前版本取自 `package.json`，目标为 Windows 10 / 11 x64。统一入口：

```powershell
npm ci
npm run package:win:internal
```

首次准备环境或依赖变化后执行 `npm ci`。之后每次打包只需第二条命令；脚本核对已安装依赖与锁文件，不接受版本漂移。需要 Node.js >=22.12、Windows PowerShell、Windows SDK x64 SignTool。请结束源码修改后再打包。

流程固定为：锁定依赖及输入快照 → 类型检查 → 单元测试与发布脚本测试 → 从 SVG 生成图标 → electron-vite 编译 → electron-builder 26 / NSIS 打包签名 → 隔离安装宏与 Shell 图标测试 → 核验 EXE 图标、品牌资源、ASAR 和签名 → 真实打包程序测试 → 比对构建前后的源码 → 保存成功产物。

每次成功构建保存在 `release/<版本>-internal-x64-<时间>-<编号>/`，不会覆盖旧包。`release/latest.json` 指向最近成功的构建；失败不会改变该记录。下列文件均位于对应构建目录：

- `QTypora-<版本>-internal-x64-setup.exe`：离线安装程序，安装到当前用户，支持选择目录。
- `QTypora-Internal-Test.cer`：本次签名的公钥证书。
- `SHA256SUMS.txt`：安装包完整文件的 SHA-256。
- `internal-build.json`：版本、架构、工具版本、输入摘要、图标校验、测试结果、签名证书指纹与到期时间。
- `logs/`：完整流程日志、输入文件逐项摘要、单元及桌面测试 JSON、签名记录与截图。
- `win-unpacked/`：供本地诊断的应用目录，不需要随安装程序分发。

失败日志保留在 `.debug/package-runs/<时间>-<编号>/logs/`。不要手动把失败的暂存安装包作为成功包分发。脚本用 `.debug/package.lock` 拒绝并发构建；正常退出自动释放。进程被强行终止时，确认没有打包进程后才可删除遗留锁文件。

`build/icon.svg` 是唯一图标来源；`npm run build:icon` 生成 PNG / ICO。窗口、任务栏、关于窗口、侧栏、安装与卸载程序、桌面及开始菜单快捷方式、“打开方式”列表和 Markdown 文档统一使用它。Shell 使用包含图标摘要的 ICO 文件名，换 Logo 后路径随之变化；安装程序通知 Windows 刷新图标。打包时核对应用及安装程序内嵌的七种尺寸图标，品牌 PNG / SVG / ICO 和界面 SVG 均须匹配源文件。仅需修改 SVG，生成文件无需手工维护。

安装程序、主程序和卸载程序采用同一本机自签名代码证书及 SHA-256 签名。安装包内含 Electron、编译后的界面、预加载脚本与本地服务；采用 ASAR 白名单打包，不包含源码、测试文档、截图、证书私钥或开发依赖。未配置自动更新与外网发布。

## 签名与核验

构建机要求 Node.js >=22.12、Windows PowerShell、Windows SDK x64 SignTool。证书由 `scripts/package-internal.ps1` 创建或复用，名称 `QTypora Internal Test Code Signing`，位于 `Cert:\CurrentUser\My`，私钥不可导出，有效期一年。到期前不足 30 天时下次打包会创建新证书，应分发配套的新 `.cer`。

签名钩子通过 SignTool `/sha1 <证书指纹> /s My /fd SHA256` 选择当前用户证书；这里 `/sha1` 指证书标识，不是文件签名的摘要算法。不调用公共时间戳服务，证书到期后需要重新打包签名。

未信任的内测电脑会显示未知发布者或 SmartScreen 提示，双击 `.cer` 或把它放在安装包旁边不会自动获得信任。证书仅用于内部测试，脚本不修改可信根证书或受信任发布者库。若团队希望建立内部信任，应先通过独立渠道比对 `internal-build.json` 的证书指纹，再按团队的证书管理流程导入对应证书。

```powershell
Get-FileHash -LiteralPath '.\QTypora-0.1.0-internal-x64-setup.exe' -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath '.\QTypora-0.1.0-internal-x64-setup.exe' |
    Select-Object Status, StatusMessage, @{Name='Signer'; Expression={$_.SignerCertificate.Subject}}, @{Name='Thumbprint'; Expression={$_.SignerCertificate.Thumbprint}}
```

文件摘要应与配套 `SHA256SUMS.txt` 一致，签名证书指纹应与 `internal-build.json` 一致。未建立信任时签名检查可报告不受信任，这与文件被篡改的摘要不匹配不同。

## 安装后验证

统一打包脚本自动对本次 `win-unpacked/QTypora.exe` 运行 `tests/packaged.spec.ts`。它启动独立临时用户目录，验证新图标、ASAR 离线加载、安全窗口配置、文件读写、默认折叠与展开、Mermaid、MathJax、本地图片及 HTML/PDF 导出，验证未保存关闭可取消。测试不依赖开发服务器，不替换当前安装，不接触用户文档。

脚本还通过独立 NSIS 测试程序执行实际的 `customInstall` / `customUnInstall` 宏，验证应用和文档注册、快捷方式图标、Windows Shell 渲染、重复安装、不创建未选择的快捷方式、旧目录卸载与当前注册清理。它使用随机命名的测试应用、私有文件扩展名和工作区内的临时目录；不会修改真实 `.md` 的关联。结果保存在 `logs/installer-icons.json`。

脚本不自动执行完整应用的安装和卸载，避免关闭使用中的应用或覆盖安装注册；`internal-build.json` 明确记录这一范围。完整 NSIS 安装向导、升级与卸载仍需在独立测试机器或虚拟机验证，不能以隔离宏测试或运行 `win-unpacked` 代替。安装后可复用相同桌面测试：

```powershell
$env:QTYPORA_PACKAGED_EXE = 'C:\实际安装目录\QTypora.exe'
npm run test:packaged
Remove-Item Env:\QTYPORA_PACKAGED_EXE
```

卸载时保留用户配置与恢复草稿；普通 `.md` 文档保存在用户原来的文件位置，不属于安装目录。内部应用注册标识为 `com.qtypora.internal`，快捷方式名称为 `QTypora Internal`。

安装程序在当前用户的 `Software\Classes` 注册 QTypora 的应用名称、图标、带引号的打开命令及 `.md` 的“打开方式”候选。它支持已有的 `Applications\QTypora.exe` 选择，也注册 `com.qtypora.internal.Markdown` 文档类型；不覆盖 `.md` 默认值或受保护的 `UserChoice`。在 Windows 中右键 `.md` → 打开方式 → 选择其他应用 → QTypora；选择始终使用后，文档显示同一 Logo。卸载仅清理仍指向本次安装目录的自身注册，保留其他应用和较新安装的注册。

## GitHub 推送自动发布

`.github/workflows/windows-release.yml` 接收所有分支的推送和手动运行请求，在 `windows-2025` 构建机使用 Node.js 24 和相同的 `npm run package:win:internal` 流程。纯标签推送及分支删除不发布安装包。本机全局 Git 扫描钩子、推送例外及其他仓库的暂停规则不受工作流影响。

`scripts/github-release.cjs` 使用工作流短期 `GITHUB_TOKEN`，仅版本检查和发布步骤通过 `GH_TOKEN` 调用 GitHub CLI。无需额外 PAT；检出操作不持久化推送凭据。GitHub Actions 权限声明为 `contents: write` 的发布任务可创建当前仓库的 Release，未配置其他写权限。

标签为 `v<package.json版本>-internal-<提交前12位>`，指向触发工作流的完整提交 ID。同一提交的运行串行处理；成功发布后重跑会验证现有版本并跳过打包。不同提交保留各自的预发布版本，不覆盖原有公开安装包。

发布前要求干净的检出目录、构建输入摘要匹配，以及完整的构建检查报告。只上传安装程序、`SHA256SUMS.txt` 和 `QTypora-Internal-Test.cer`，不上传 `win-unpacked/`、本地路径记录、构建日志或私钥到公开 Release。CI 的证书在临时构建机创建，因此每次新构建的证书指纹可能不同；应使用该版本配套的公钥和摘要核验。

上传首先创建属于该提交的草稿，核对 GitHub 返回的三份资源大小和 SHA-256 后才公开。网络失败保留草稿；重跑会复用它，并仅补传或替换草稿中的不匹配资源。已公开版本不会被自动替换，标签冲突、额外资源、权限不足或校验失败会明确报错。

仓库 Actions → **Windows internal release** 可查看进度、运行日志、手动运行和重跑失败任务。`.debug/package-runs/` 的构建日志以 Actions 附件保留 7 天；公开版本见仓库 Releases。修改发布脚本后运行 `npm run test:release`。若需停止自动发布，在 GitHub Actions 页面禁用该工作流；已发布版本保留。

## 官方资料

- [electron-vite 分发说明](https://electron-vite.org/guide/distribution)
- [electron-builder 26 Windows 签名配置](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)
- [electron-builder 26 NSIS 配置](https://www.electron.build/v26/docs/nsis/)
- [Microsoft SignTool 参数](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [Microsoft 应用注册与打开方式图标](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)
- [Microsoft 文档类型图标与缓存刷新](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-assign-a-custom-icon-to-a-file-type)
- [GitHub Actions 工作流语法、触发和权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [官方 Windows 2025 构建机工具清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [GitHub Release 资源及摘要接口](https://docs.github.com/en/rest/releases/assets)
