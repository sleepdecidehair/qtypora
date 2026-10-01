# 故障复盘：Electron 44 剪贴板接入误用旧同步 API

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-09-30 |
| 发现人 | 桌面服务代理，项目类型检查 |
| 严重程度 | P2，开发阶段构建阻断 |
| 影响范围 | 新增的 readClipboardText/writeClipboard 主进程 handler |
| 关联 Issue/PR/提交 | 无；未提交，未部署给用户 |

## 问题描述

新增右键复制和粘贴服务时，初稿使用了旧版本 Electron 的同步 `clipboard.readText()` 与 `clipboard.write({ text, html })`。首次 `npm run typecheck` 在 `src/main/index.ts` 报告：

```text
Argument of type 'Promise<string>' is not assignable to parameter of type 'string ...'
Type 'ClipboardContent' is missing the following properties from type 'ClipboardItem[]' ...
```

代码没有进入用户调试进程，也没有写入用户剪贴板。

## 根因分析

1. 类型检查表明 readText 已返回 Promise，而 write 要求 ClipboardItem 数组。
2. 检查安装的 `node_modules/electron/electron.d.ts` 中 Clipboard 接口，确认 readText、write 均异步。
3. 核对 [Electron 官方 Clipboard 文档](https://www.electronjs.org/docs/latest/api/clipboard)，确认当前接口采用 W3C ClipboardItem，并要求一次 write 提交数组。
4. 直接原因是对已升级 SDK 使用历史 API 记忆。根本原因是没有在编写第一稿之前把已安装版本的声明与厂商文档进行一致性检查。
5. 本次在类型门禁首次发现，未出现运行时或用户数据影响；如果用 any 绕过类型，可能错误返回 Promise 或无法写入系统剪贴板。

## 解决方案

修改位置：`src/main/index.ts:300` 与 `src/main/index.ts:305`。

```typescript
const text = await clipboard.readText()
await clipboard.write([new ClipboardItem({
  'text/plain': content.text,
  ...(content.html === undefined ? {} : { 'text/html': content.html }),
})])
```

preload 和 shared Result 契约保持异步固定方法。原生层完成读取后执行 UTF-8 大小限制；写入只允许 text/plain 与可选 text/html，不记录内容。

## 验证与预防

- `npm run typecheck` 已通过；Clipboard 入参空文本、类型、NUL、UTF-8 超限单测通过。
- 根代理的真实 Electron 回归负责系统剪贴板 roundtrip；模块单测只证明边界校验，不冒充系统集成。
- 后续 Electron SDK 接入先读取已安装 electron.d.ts 的真实声明，再核对对应官方文档；不使用 any 或类型断言掩盖第三方方法签名不符。

## 经验

升级后的 SDK API 必须以安装版本声明和官方文档为准，历史同步调用不能直接复用。
