# Agent Note：默认集成 AWiki 的 Electron 发行版

Status: implemented

[English](2026-08-15-awiki-electron-distribution.md) | 中文

## 问题

独立发布的 AWiki 插件需要成为 DeepSeek Harness 的默认组合，并需要可复现的桌面安装包。现有 Web profile 是权威应用界面，而原生模块必须针对每个目标操作系统的 Electron ABI 重新构建。

## 决策

在 Web 应用层之后把已发布的 `dsh-awiki` bundle 加入出厂 Web profile，并且只迁移上一版完全一致的出厂 tuple。用户自定义过的 bundle 列表保持不变。插件的 `awiki` 设置 namespace 通过产品设置 API 暴露。

把此前的回环 Electron 验收壳层提升为跨平台发行版。它拥有现有 CLI Host 子进程，只在启用 sandbox 的渲染进程中加载规范的 `127.0.0.1` origin，把生产依赖闭包暂存在 ASAR 外，并针对目标 Electron ABI 重建原生模块。GitHub Actions 使用原生 runner 构建 arm64 macOS DMG 和 x64 Windows Squirrel Setup EXE。

## 考虑过的替代方案

- 不采用继续让 AWiki 作为可选 profile 的方案，因为产品目标是让新安装默认可用。
- 不采用重写所有现有 profile 的方案，因为自定义 bundle 列表属于用户配置。
- 不采用单独实现一套桌面应用的方案，因为那会重复 Host、Web、持久化和插件行为。
- 不在 macOS 上交叉构建 Windows 安装包，而是在原生 Windows runner 上重建原生依赖。

## 后果

- 新建和上一版原样的 Web profile 无需额外插件命令即可使用 AWiki；自定义 profile 不会被改写。
- macOS 和 Windows 安装包复用 CLI 的 Host、Web UI、profile、持久化和插件契约。
- 第一批安装包未签名；Gatekeeper、SmartScreen、公证和可信发布者身份仍是明确的发行加固工作。
- 回环监听仍只绑定本机；未来可用受限 IPC carrier 替换，而无需修改 profile 或 AWiki 包。
