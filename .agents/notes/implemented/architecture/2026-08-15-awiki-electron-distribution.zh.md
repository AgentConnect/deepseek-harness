# Agent Note：默认集成 AWiki 的 Electron 发行版

Status: implemented

[English](2026-08-15-awiki-electron-distribution.md) | 中文

## 问题

独立发布的 AWiki 插件需要成为 DeepSeek Harness 的默认组合，并需要可复现的桌面安装包。现有 Web profile 是权威应用界面，而原生模块必须针对每个目标操作系统的 Electron ABI 重新构建。

## 决策

在 Web 应用层之后把已发布的 `dsh-awiki` bundle 加入出厂 Web profile，并且只迁移上一版完全一致的出厂 tuple。用户自定义过的 bundle 列表保持不变。插件的 `awiki` 设置 namespace 通过产品设置 API 暴露。

把此前的回环 Electron 验收壳层提升为跨平台发行版。它拥有现有 CLI Host 子进程，只在启用 sandbox 的渲染进程中加载规范的 `127.0.0.1` origin，并针对目标 Electron ABI 重建原生模块。构建会把 Electron 之外的所有主进程依赖打入 bundle，并拒绝仍然保留其他裸包导入的生成入口。由于 Squirrel 的 NuGet 层无法枚举超过旧版 Windows 路径限制的第三方文件，构建会把生产依赖闭包保存为单个压缩资源。首次启动时在 Electron 用户数据目录中原子解压带版本的运行时，后续启动复用经过验证的解压结果。GitHub Actions 使用原生 runner 构建 arm64 macOS DMG 和 x64 Windows Squirrel Setup EXE。

macOS 发行凭据是全有或全无的构建输入。`Developer ID Application` 身份签名应用与 DMG，Apple ID 公证凭据提交并装订应用，CI 把 P12 导入临时钥匙串并在打包后删除。导入过程向签名工具开放私钥访问权限，把临时钥匙串加入 runner 的用户搜索列表，并拒绝未暴露所配置身份的 P12。没有凭据时仍可执行本地和拉取请求验证构建；凭据不完整或使用非发行身份会直接失败。DMG 明确使用产品 ICNS 作为挂载后的卷宗图标。

## 考虑过的替代方案

- 不采用继续让 AWiki 作为可选 profile 的方案，因为产品目标是让新安装默认可用。
- 不采用重写所有现有 profile 的方案，因为自定义 bundle 列表属于用户配置。
- 不采用单独实现一套桌面应用的方案，因为那会重复 Host、Web、持久化和插件行为。
- 不在 macOS 上交叉构建 Windows 安装包，而是在原生 Windows runner 上重建原生依赖。
- 不把运行时作为数千个松散的 extra-resource 文件交给安装器，因为合法的传递 SDK 文件名会在 EXE 生成前超过 Squirrel 的 NuGet 路径限制。
- 不把 Apple 证书提交到仓库，因为仓库绝不能包含对应私钥；CI 通过加密的仓库 Secrets 接收它，并使用临时钥匙串。
- 不回退使用 Apple Development 身份，因为它不能建立 Gatekeeper 接受的公开 Developer ID 发行身份。

## 后果

- 新建和上一版原样的 Web profile 无需额外插件命令即可使用 AWiki；自定义 profile 不会被改写。
- macOS 和 Windows 安装包复用 CLI 的 Host、Web UI、profile、持久化和插件契约。
- 首次启动会执行一次可信归档解压；与归档大小绑定的标记明确控制复用，未完成的解压结果不会被发布为当前运行时。
- 完整的 Developer ID Secret 存在后，macOS 发行构建会自动完成签名与公证；缺少凭据时，验证构建保持明确的未签名状态。
- 挂载后的 DMG 使用 DeepSeek Harness 卷宗图标，而不是安装器依赖的 Electron 默认图标。
- 回环监听仍只绑定本机；未来可用受限 IPC carrier 替换，而无需修改 profile 或 AWiki 包。
