# DeepSeek Harness 桌面版

[English](README.md) | 中文

这个 Electron 发行版把现有 `dsh web` 作为受控的本机回环子进程启动，并在启用 sandbox 的 Electron 窗口中展示。标准 Web profile 默认包含 `@awiki/dsh-plugin`，因此首次启动即可通过公开服务默认值使用 AWiki 身份、消息和模型引导。

## 本地开发

```sh
pnpm --filter deepseek-harness-electron start:dev
```

此命令会构建并启动桌面应用，将 DSH 状态保存到 `.dev-state/dsh`，将 AWiki 身份和消息状态保存到 `.dev-state/awiki-im-core`，将 Electron 的 Cookie、偏好设置、缓存和浏览器存储保存到 `.dev-state/electron`，并默认使用仓库根目录作为智能体工作目录。`.dev-state` 已被 Git 忽略，所有开发数据都与已安装应用的数据相互隔离，因此不需要卸载已安装的正式版。

Electron 壳层负责本地 Host 的完整生命周期。运行中的 Host 意外退出时，现有窗口会切换到本地恢复状态，并在一分钟滚动窗口内进行两次有界自动重启。连续失败后会明确提供重新启动、复制脱敏诊断信息和退出操作，不会再在用户确认错误后直接关闭应用。正常退出应用时仍会等待受控 Host 完全停稳。

如需测试尚未发布的插件归档及其尚未发布的运行时依赖，同时不修改已提交依赖，可在仓库根目录创建已忽略的 `.dev-package-overrides.json`。每个值都是绝对归档路径，或相对于配置文件的路径：

```json
{
  "@scope/plugin": ".dev-package-overrides/archives/plugin.tgz",
  "@scope/sdk": ".dev-package-overrides/archives/sdk.tgz",
  "@scope/native": ".dev-package-overrides/archives/native.tgz"
}
```

`start:dev` 会先构建工作区，再在 Electron 启动前校验并挂载每个打包产物。至少一个已配置包必须是 CLI 的直接依赖。其余每个已配置包都必须能够从这个本地包的 `dependencies`、`optionalDependencies` 或 `peerDependencies` 递归到达；只有直接包挂载到 CLI 解析器中，本地传递包保留在其真实父包下。已配置的本地归档优先于同名公开包。其他已声明依赖从已安装公开包的锁定闭包和 CLI 工作区解析，因此如果直接包尚未安装，需先运行一次 `pnpm install --frozen-lockfile`。配置文件不存在时使用公开依赖；JSON 无效、没有直接根包、存在不可达的包归档、归档缺失、归档内包名不匹配或已安装的必需依赖缺失时，启动会直接失败。解压后的包及其生成的依赖链接保存在已忽略的 `.dev-package-overrides/` 目录中，与 `.dev-state` 分离，因此清除首次启动的应用数据不会丢失包覆盖配置。manifest、lockfile、普通 `start` 启动和正式发行打包命令仍使用公开依赖。

## 构建安装包

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:mac:x64
pnpm --filter deepseek-harness-electron make:windows
```

两个 macOS 命令分别生成 Apple Silicon arm64 和 Intel x64 的 DMG 与 ZIP。正式构建应在与目标架构一致的原生 runner 上运行。Windows 命令生成 x64 NSIS 引导式安装程序，必须在 Windows 环境执行。安装向导允许用户选择安装目录，并创建桌面和开始菜单快捷方式。所有命令都会构建 DSH、验证 Electron 主进程不存在未打包的运行时依赖、按显式指定的平台和架构暂存生产运行时、针对 Electron ABI 重建原生模块、把运行时封装为单个适合安装器的资源，并生成平台图标。macOS 构建还会核对外层可执行文件和暂存运行时内每个 Mach-O 文件的目标架构，比较运行时来源记录与构建模式，并检查 DMG 和 ZIP 容器。DMG 卷宗图标使用产品图标。首次启动时，壳层会把带版本的运行时原子解压到 Electron 用户数据目录，后续启动直接复用。

只有在安装包必须包含 `.dev-package-overrides.json` 中的本地插件归档时，才使用带 `:local` 的显式命令：

```sh
pnpm --filter deepseek-harness-electron make:mac:local
pnpm --filter deepseek-harness-electron make:mac:x64:local
```

这些命令要求至少配置一个直接归档，要求所有非可选依赖和 peer 都已存在于从 lockfile 暂存的运行时中，而且打包期间绝不会额外安装依赖。运行时会为每个直接或传递本地归档记录目标平台和架构、归档 SHA-256、包版本、相对于解析器的安装路径和安装后包摘要；构建后的校验会把这些值与当前配置及安装包内容逐项比较。不带 `:local` 的命令会忽略 `.dev-package-overrides.json`，并拒绝意外包含本地覆盖的产物。

Apple Silicon Mac 可以直接生成未签名的 Intel 联调安装包。打包流程会把 x64 目标显式传给所有与目标架构有关的阶段，因此宿主 Node 进程继续使用原生 arm64：

```sh
pnpm --filter deepseek-harness-electron make:mac:x64:local
```

Intel DMG 会写入 `experiments/electron/out/make/DeepSeek Harness-0.1.1-x64.dmg`，ZIP 位于 `experiments/electron/out/make/zip/darwin/x64/`。`package:mac:x64:local` 使用相同的暂存和架构校验，但只生成未封装的 `.app`；`make:mac:x64:local` 还会生成并校验 DMG 和 ZIP。

`Desktop installers` GitHub Actions 工作流在原生 runner 上运行相同命令。通过 `Run workflow` 可以手动构建安装包。Windows job 验证安装程序配置和内置的 `@awiki/dsh-plugin` 版本，在运行摘要中发布 EXE 大小和 SHA-256，并将 EXE 作为 `deepseek-harness-windows-x64` artifact（产物）保留 14 天。

缺少 Apple 凭据时，本地构建仍生成未签名安装包。`DSH_MACOS_SIGN_IDENTITY`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID` 全部存在时，发行构建先用 Hardened Runtime 和安全时间戳签名压缩生产运行时内的每个 Mach-O 文件，再使用同一个 `Developer ID Application` 身份签名应用与 DMG。它先提交并装订应用，再单独提交最终 DMG 容器、装订其票据，并验证 Developer ID 签名、Gatekeeper 安装评估、磁盘镜像校验和、只读挂载、产品卷宗图标与应用包；凭据不完整会直接使构建失败。CI 从 `MACOS_CERTIFICATE_P12_BASE64` 和 `MACOS_CERTIFICATE_PASSWORD` 把受密码保护的 P12 导入临时钥匙串，打包后删除该钥匙串。证书与私钥只能存放在仓库 Secrets 中，不能提交到源码。Windows 代码签名、自动更新、崩溃上报，以及用受限 IPC carrier 替换回环传输，仍属于发行加固工作。
