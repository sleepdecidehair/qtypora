# 故障复盘：Windows 内测打包跨 PowerShell 模块加载失败

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-10-01 |
| 严重程度 | P2，阻断新增打包脚本，未影响编辑器 |
| 影响范围 | 从 PowerShell 7 宿主经 npm 启动 Windows PowerShell 5.1 的打包命令 |
| 关联 Issue / 提交 | 本地工作区，无 Git 仓库与提交 |

## 问题描述

`npm run package:win:internal` 首次运行，证书枚举报 `A parameter cannot be found that matches parameter name 'CodeSigningCert'`；改为普通枚举后显示 `Cannot find drive. A drive with the name 'Cert' does not exist`。按名称导入安全模块又出现 `System.Security.AccessControl.ObjectSecurity` 的 `AuditToString` 等类型成员重复。第一次安装包已经签名完成，但摘要输出阶段发现 `Get-FileHash` 未加载。

这些错误均出现在新打包流程，没有修改现有应用文档，也没有导入可信根证书。中间产物未作为成功包交付。

## 根因分析

1. 当前终端为打包环境自带的 PowerShell 7.6.5；npm 入口调用系统 `powershell.exe` 5.1。
2. 证书路径与 PKI 命令在独立系统 PowerShell 查询中可用，排除了未安装 PKI / Windows SDK。
3. 按模块名加载时，继承的 `PSModulePath` 包含 PowerShell 7 运行时模块，模块解析与 Windows PowerShell 5.1 自带组件冲突。
4. 明确导入 `C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1` 后证书提供程序正常。进一步在打包子进程中限定为匹配宿主的模块目录，Utility 与 PKI 均正确加载，摘要生成恢复。
5. 最初只在当前 PowerShell 7 会话检查工具，遗漏了真正 npm 子进程的 5.1 模块解析环境。

## 解决方案

`scripts/package-internal.ps1` 在任何证书操作之前，为打包进程设置匹配 `$PSHOME` 的 `PSModulePath`，明确加载 Security、Utility 与 PKI。调整仅作用于子进程，不修改系统环境配置。证书枚举直接检查代码签名 EKU，避免依赖动态参数自动加载。

签名验证补充 `scripts/verify-signature.ps1`，直接调用 WinVerifyTrust；仅允许完全通过或内测自签名预期的 `CERT_E_UNTRUSTEDROOT (0x800B0109)`，其他错误全部停止交付。PowerShell 5.1 的高位十六进制字面量会先成为负数，因此通过 `Convert.ToUInt32(..., 16)` 比较原始状态码。

## 验证与预防

- 用实际 npm 入口运行完整检查、构建、NSIS 和签名流程，而不仅从当前宿主读取命令是否存在。
- 安装后主程序与卸载程序的签名指纹匹配同一证书，WinVerifyTrust 返回预期的未信任根证书状态。
- 修改一次性 `.bin` 数据副本中的受签名内容，WinVerifyTrust 返回 `TRUST_E_BAD_DIGEST (0x80096010)`；原始程序和安装包未被修改。
- 真实安装后的 ASAR 应用离线读写、图表、公式、图片、折叠和 HTML/PDF 导出测试通过。
- 后续添加 Windows 打包脚本时，应同时核对调用宿主版本、模块路径、提供程序加载与退出码。失败命令必须停止产物交付，不能把文件已存在当作构建成功。
