# Agent Note: 传递开发包覆盖保持真实运行时依赖图

Status: implemented

[English](2026-08-20-transitive-development-package-overrides.md) | 中文

## Problem

原有的已忽略开发包配置只接受 DSH CLI 直接声明的包。这适用于运行时 API 与公开依赖闭包一致的未发布插件，但无法同时测试插件和尚未发布的 SDK 或原生平台包。只替换插件会形成混合运行时：当前 browser 与 Host bundle 已加载，Node 却仍解析到旧版公开 SDK 和 addon。

把每个已配置归档都当作 CLI 顶层包可以掩盖这个问题，但会凭空创造正式消费者并不存在的解析路径。本地安装包的来源记录也假定每个覆盖都位于顶层 `node_modules`，因而无法标识真实的传递安装位置。

## Decision

`.dev-package-overrides.json` 包含一个或多个已打包的 CLI 直接依赖，也可以包含已打包的传递依赖。应用器会先解压并校验所有归档，再从已配置的直接根出发，沿每个本地 manifest 的 `dependencies`、`optionalDependencies` 和 `peerDependencies` 计算可达性。没有直接根或包含不可达归档的配置会在 Electron 启动前失败。

每个本地包都有自己的依赖 overlay。已配置的本地归档优先于同名公开包；其他依赖继续从直接包基于 lockfile 的公开闭包和 CLI 工作区解析。只有已配置的直接依赖会链接到 CLI `node_modules`。传递本地包只从选定的可达父包 overlay 链接，因此运行时解析遵循正式安装所使用的包依赖图。

本地安装包暂存会按从浅到深的顺序物化同一张依赖图，不复制临时 overlay 目录。运行时来源记录 schema version 2 保存每个直接或传递归档的 SHA-256、版本、相对于解析器的包路径和安装目录摘要。产物校验读取该路径，不再假设包一定在顶层。

## Alternatives considered

**只覆盖直接插件，所有传递包继续使用公开版本。** 不采用，因为插件可能针对未发布 SDK API 编译，而 Electron 会无提示地加载旧版公开 SDK。窗口成功启动不能证明新的 Host 操作能够执行。

**把每个已配置归档都挂到 CLI 顶层 `node_modules`。** 不采用，因为这会改变 Node 解析，使本地测试通过一条正式消费者不会获得的包路径。

**把 workspace link 或 tarball 路径提交到 manifest 和 lockfile。** 不采用，因为这些路径与单台机器绑定，会污染普通开发、正式发行打包和依赖来源。覆盖配置继续保持忽略且需要显式启用。

## Consequences

本地集成现在可以在不发布、也不修改 tracked 依赖元数据的前提下，证明一组一致的未发布插件、SDK 和原生 addon。无效或无关归档会失败关闭，暂存安装包会记录每个归档的真实落点。

配置必须列出测试中每个字节有意义的未发布包。没有配置同名本地归档时，公开依赖仍是权威来源。一个包若能从多个本地父包到达，会按已排序直接根的确定性广度优先第一条路径物化；开发时，每个声明它的父包仍解析到同一个已解压本地包。
