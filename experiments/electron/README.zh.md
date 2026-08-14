# DeepSeek Harness 桌面版

[English](README.md) | 中文

这个 Electron 发行版把现有 `dsh web` 作为受控的本机回环子进程启动，并在启用 sandbox 的 Electron 窗口中展示。标准 Web profile 默认包含 `dsh-awiki`，因此首次启动即可使用公开 `awiki.ai` 服务默认值访问 AWiki。

## 构建安装包

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:windows
```

macOS 命令生成 arm64 DMG 和 ZIP；Windows 命令生成 x64 Squirrel Setup EXE，必须在 Windows 环境执行。两个命令都会构建 DSH、验证 Electron 主进程不存在未打包的运行时依赖、暂存生产运行时、针对 Electron ABI 重建原生模块、把运行时封装为单个适合安装器的资源，并生成平台图标。DMG 卷宗图标使用产品图标。首次启动时，壳层会把带版本的运行时原子解压到 Electron 用户数据目录，后续启动直接复用。

缺少 Apple 凭据时，本地构建仍生成未签名安装包。`DSH_MACOS_SIGN_IDENTITY`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID` 全部存在时，发行构建使用 `Developer ID Application` 身份签名应用与 DMG，并把应用提交 Apple 公证；凭据不完整会直接使构建失败。CI 从 `MACOS_CERTIFICATE_P12_BASE64` 和 `MACOS_CERTIFICATE_PASSWORD` 把受密码保护的 P12 导入临时钥匙串，打包后删除该钥匙串。证书与私钥只能存放在仓库 Secrets 中，不能提交到源码。Windows 代码签名、自动更新、崩溃上报，以及用受限 IPC carrier 替换回环传输，仍属于发行加固工作。
