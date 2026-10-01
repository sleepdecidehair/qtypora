# 故障复盘：Windows PowerShell 5.1 未显式按 UTF-8 读取报告

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-10-01 |
| 发现人 | Codex 完整打包检查 |
| 严重程度 | P2 一般 |
| 影响范围 | 新打包脚本读取测试报告及复制中文说明文件；没有更新成功构建记录 |
| 关联 Issue / PR / 提交 | 本地目录没有 Git 仓库 |

## 1. 问题描述

运行 `20261001-115802-5db0756c` 中，223 项单元测试、应用及安装程序图标校验、签名检查和 1 项真实打包程序测试均成功。随后 `Get-Content -Raw | ConvertFrom-Json` 读取含中文测试名称的 UTF-8 JSON 报错 `Invalid object passed in, ':' or '}' expected`，流程正确地没有发布成功目录。

## 2. 临时解决方案

保留报告和已签名暂存包作为诊断样本。修复编码边界后重新运行入口，不跳过报告检查。

## 3. 根本原因分析

1. 同一报告可被 Node JSON.parse 和 PowerShell 7 解析，说明测试报告不是损坏 JSON。
2. 在真实 Windows PowerShell 5.1 中使用 `Get-Content -Encoding UTF8` 后，单元报告读出 223 项通过，桌面报告读出 1 项通过。
3. Windows PowerShell 默认文本编码与 Node 输出的无 BOM UTF-8 不一致，中文字节被错误解码，破坏后续 JSON 解析。
4. 顺带检查 PowerShell 脚本，发现中文说明文件名也依赖无 BOM 脚本源码编码，存在相同兼容风险。

直接原因位于 `scripts/package-internal.ps1` 的所有 JSON 读取和说明文件复制。根本原因是按 PowerShell 7 环境的默认编码编写了由 Windows PowerShell 5.1 执行的脚本。早期类型及编译检查不覆盖脚本的宿主编码，第二轮完整流程才进入含中文报告的读取分支。

## 4. 解决方案

所有 JSON 读取明确使用 `-Encoding UTF8`；PowerShell 脚本保持 ASCII，中文说明路径的复制交给本来就按 UTF-8 解释源码的 Node `package-checks.cjs notes`。输出 JSON 继续明确使用 UTF-8；Node 读取时兼容 BOM。

同一真实报告在 Windows PowerShell 5.1 下验证通过，并检查生成说明文件名称及内容正确。

## 5. 预防措施

- 跨 Node / Windows PowerShell 的文件边界必须明确指定 UTF-8。
- 按实际打包入口的 PowerShell 5.1 测试中文名称和非 ASCII 内容，不能只依赖交互宿主 PowerShell 7。
- 完整测试报告读取、说明文件生成和成功目录更新必须纳入最终验证。

## 6. 经验总结

调用哪个 PowerShell 宿主与交互终端用哪个宿主可能不同，文本编码必须显式规定。
