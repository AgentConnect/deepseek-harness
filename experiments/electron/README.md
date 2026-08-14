# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This Electron distribution starts the existing `dsh web` application as an owned loopback child process and displays it in a sandboxed Electron window. The standard Web profile includes `dsh-awiki` by default, so AWiki is available on first launch with the public `awiki.ai` service defaults.

## Build installers

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:windows
```

The macOS command produces an arm64 DMG and ZIP. The Windows command produces an x64 Squirrel Setup EXE and must run on Windows. Both commands build DSH, stage the production runtime, rebuild native modules for Electron's ABI, and generate platform icons.

The current installers are unsigned. macOS notarization, Windows code signing, automatic updates, crash reporting, and replacing the loopback transport with a scoped IPC carrier remain release-hardening work.
