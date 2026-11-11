# 故障复盘：macOS 多 worktree 打包锁可能分裂

## 基本信息

2026-11-01；P1 发布产物竞争风险；发现于多 Agent 代码审查；关联修复提交 `dd9ab38`。

## 问题与根因

打包互斥锁原先位于当前 worktree 的 `.debug`，linked worktree 可各自取得锁并并发写共享 release；初步修复又假设 Git common directory 的目录名一定为 `.git`，在 `--separate-git-dir` 下仍会分裂。根因是从工作区路径和目录名推断共享仓库身份，而没有直接使用 Git 提供的 common-dir 与 worktree 元数据。

相关位置：`scripts/package-mac-internal.cjs:8-41`、`:99`，`scripts/package-mac.test.cjs:29-64`。

## 解决方案

锁文件直接放入 `git rev-parse --git-common-dir` 返回的目录，以原子 `wx` 创建；release 根目录通过 `git worktree list --porcelain -z` 的首个主 worktree 解析，不依赖 common-dir 名称。finally 关闭句柄并删除锁，文档明确强杀后的人工清理条件。

## 验证与预防

macOS 打包脚本测试覆盖标准 `.git`、linked worktree、独立 Git 元数据目录、原子冲突和主 worktree 解析。任何跨 worktree 共享资源的锁和输出目录都应从 Git 元数据解析，并用非 `.git` common-dir 作为回归用例。
