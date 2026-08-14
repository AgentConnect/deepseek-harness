# DeepSeek Harness 桌面版

[English](README.md) | 中文

这个 Electron 发行版把现有 `dsh web` 作为受控的本机回环子进程启动，并在启用 sandbox 的 Electron 窗口中展示。标准 Web profile 默认包含 `dsh-awiki`，因此首次启动即可使用公开 `awiki.ai` 服务默认值访问 AWiki。

## 构建安装包

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:windows
```

macOS 命令生成 arm64 DMG 和 ZIP；Windows 命令生成 x64 Squirrel Setup EXE，必须在 Windows 环境执行。两个命令都会构建 DSH、暂存生产运行时、针对 Electron ABI 重建原生模块并生成平台图标。

当前安装包未签名。macOS 公证、Windows 代码签名、自动更新、崩溃上报，以及用受限 IPC carrier 替换回环传输，仍属于发行加固工作。
