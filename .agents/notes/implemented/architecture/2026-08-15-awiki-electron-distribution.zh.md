# Agent Note：默认集成 AWiki 的 Electron 发行版

Status: implemented

[English](2026-08-15-awiki-electron-distribution.md) | 中文

## 问题

独立发布的 AWiki 插件需要成为 DeepSeek Harness 的默认组合，并需要可复现的桌面安装包。现有 Web profile 是权威应用界面，而原生模块必须针对每个目标操作系统的 Electron ABI 重新构建。

## 决策

在 Web 应用层之后把已发布的规范包 `@awiki/dsh-plugin` bundle 加入出厂 Web profile。只迁移包含已停用包名 `@awiki/dsh` 的上一版完全一致出厂 tuple；用户自定义过的 bundle 列表保持不变。插件的 `awiki` 设置 namespace 通过产品设置 API 暴露。

把此前的回环 Electron 验收壳层提升为跨平台发行版。它拥有现有 CLI Host 子进程，只在启用 sandbox 的渲染进程中加载规范的 `127.0.0.1` origin，并针对目标 Electron ABI 重建原生模块。构建会把 Electron 之外的所有主进程依赖打入 bundle，并拒绝仍然保留其他裸包导入的生成入口。构建把生产依赖闭包保存为单个压缩资源，使安装器工具无需枚举层级很深的第三方依赖路径。首次启动时在 Electron 用户数据目录中原子解压带版本的运行时，后续启动复用经过验证的解压结果。GitHub Actions 使用与目标架构一致的原生 runner 构建 arm64 和 Intel x64 macOS DMG/ZIP，以及 x64 Windows NSIS 引导式安装程序。

仓库内的开发启动命令把 DSH 状态、AWiki IM 状态，以及 Electron 管理的 Cookie、偏好设置、缓存和浏览器存储分别放到 `.dev-state` 下已忽略的目录中。Electron 路径覆盖只接受绝对路径，在 `app.whenReady()` 之前生效，并且不会出现在正常安装版启动中，因此开发版和安装版的数据不会重叠。已忽略的本机配置可以把已声明的 CLI 依赖映射到 npm 打包归档。启动器先执行构建，再校验归档并解压到已忽略的内容寻址目录，根据已安装公开包闭包和 CLI 工作区生成精确的依赖链接，最后在 Electron 启动前将其原子挂载到 CLI 解析路径。配置不存在时保留公开依赖；配置格式错误、归档缺失、包未声明或未安装、依赖解析不完整、归档内包名不匹配时启动失败。

正式发行打包命令会忽略本机配置，始终依据 manifest 和 lockfile 暂存运行时。显式的 `:local` 打包命令只会在部署该锁定闭包后应用同一组归档，要求每个非可选依赖和 peer 都已经存在，并且发现未跟踪依赖时直接失败而不是安装新包。运行时暂存把目标平台和架构作为 Electron 重建、原生辅助程序权限恢复、裁剪和签名的必填输入，绝不会从宿主 Node 进程推断目标。每个运行时都会记录目标信息，以及本地归档的 SHA-256、包版本和安装后包摘要。macOS 打包会核对外层可执行文件和暂存运行时内每个 Mach-O 文件的目标架构，检查运行时来源记录和已配置归档，并校验 DMG 与 ZIP 容器。因此 Apple Silicon 开发者可以直接从原生 arm64 Node 环境执行 Intel 本地插件打包命令，而正式发行仍使用原生 runner。

macOS 发行凭据是全有或全无的构建输入。生产运行时压缩前，每个已暂存的 Mach-O 可执行文件、原生扩展和动态库都会启用 Hardened Runtime 并带安全时间戳签名；这是因为 Electron Packager 能签名外层应用，却看不到运行时归档内部的原生代码。同一个 `Developer ID Application` 身份随后签名应用与 DMG。Apple ID 公证凭据在打包期间提交并装订应用，随后把最终 DMG 作为独立公证对象提交、装订其票据，并以 `codesign`、`stapler`、Gatekeeper 安装评估、镜像校验和及真实只读挂载作为上传产物的门禁；挂载后还会检查产品卷宗图标和应用包。CI 把 P12 导入临时钥匙串并在打包后删除。导入过程向签名工具开放私钥访问权限，把临时钥匙串加入 runner 的用户搜索列表，并拒绝未暴露所配置身份的 P12。没有凭据时仍可执行本地和拉取请求验证构建；凭据不完整或使用非发行身份会直接失败。DMG 明确使用产品 ICNS 作为挂载后的卷宗图标。

## 考虑过的替代方案

- 不采用继续让 AWiki 作为可选 profile 的方案，因为产品目标是让新安装默认可用。
- 不采用重写所有现有 profile 的方案，因为自定义 bundle 列表属于用户配置。
- 不采用单独实现一套桌面应用的方案，因为那会重复 Host、Web、持久化和插件行为。
- 不在 macOS 上交叉构建 Windows 安装包，而是在原生 Windows runner 上重建原生依赖。
- 不把运行时作为数千个松散的 extra-resource 文件交给安装器，因为合法的传递 SDK 文件名会在 EXE 生成前超过 Squirrel 的 NuGet 路径限制。
- 不把 Apple 证书提交到仓库，因为仓库绝不能包含对应私钥；CI 通过加密的仓库 Secrets 接收它，并使用临时钥匙串。
- 不回退使用 Apple Development 身份，因为它不能建立 Gatekeeper 接受的公开 Developer ID 发行身份。
- 不在 manifest 或 lockfile 中记录本地 tarball 路径，因为特定机器的开发输入不能影响可复现的安装与发行产物。
- 不让普通正式发行命令根据已忽略的本地覆盖进行条件切换，因为同一命令在干净 checkout、CI 和维护者工作站上必须使用相同的依赖输入。

## 后果

- 新建和上一版原样的 Web profile 无需额外插件命令即可使用 AWiki；自定义 profile 不会被改写。
- macOS 和 Windows 安装包复用 CLI 的 Host、Web UI、profile、持久化和插件契约。
- 首次启动会执行一次可信归档解压；与归档大小绑定的标记明确控制复用，未完成的解压结果不会被发布为当前运行时。
- 完整的 Developer ID Secret 存在后，macOS 发行构建会自动完成签名与公证；缺少凭据时，验证构建保持明确的未签名状态。
- 挂载后的 DMG 使用 DeepSeek Harness 卷宗图标，而不是安装器依赖的 Electron 默认图标。
- 仓库内的开发启动命令不会读写安装版的 DSH、AWiki 或 Electron 用户数据目录。
- 未发布的插件构建可以在单个开发 checkout 中替换已声明的 CLI 依赖，而不会修改公开依赖图。它们只会通过显式的本地插件打包命令进入安装包，且来源记录和安装后内容都会经过校验。
- Electron 外壳、暂存的原生依赖、保留的 `node-pty` 预构建、运行时签名步骤和构建后产物校验会使用一致的目标架构。
- 回环监听仍只绑定本机；未来可用受限 IPC carrier 替换，而无需修改 profile 或 AWiki 包。
