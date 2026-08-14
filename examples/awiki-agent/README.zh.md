# AWiki Agent 示例

[English](README.md) | 中文

本示例通过真实 Cordis Loader 组合验证 AWiki 插件，但不连接 AWiki 部署。Fake provider 让两个已配置 Agent 使用同一 DID，并覆盖身份读取、会话与历史读取、经审批的私聊与既有群聊发送、单附件和 provider 异步释放。Golden snapshot 记录每个模型可见工具调用与结果，并拒绝 secret marker（秘密标记）。

在仓库根目录运行 keyless snapshot：

```sh
pnpm exec vitest run --config vitest.snapshot.config.ts examples/awiki-agent/tests/awiki.snapshot.ts
```

`tests/remote-acceptance.ts` 是由 `awiki-system-test` 消费的可选真实服务 runner。它只使用 `@anp/typescript-sdk`，不会启动或调用 MCP server。系统测试先通过 runner 注册一个主 Legacy 身份，再准备独立 peer SDK state 和受跟踪的 transport-protected 群，并把主身份加入群组。验收阶段让两个 Harness Agent 通过主 DID 发送消息，由 peer 观察私聊与群聊消息，校验下载附件字节与 SHA-256，重启主组合并写出封闭、无秘密的报告。

远端 runner 需要经评审的服务配置，以及只通过进程环境传入的手机号与 OTP。必须通过 `awiki-system-test` 场景运行，不能直接调用；该场景创建临时 peer 和群组，登记主身份、peer 身份与群组以便清理，并只向验收进程传递私有 state 和目标。缺少远端前置条件时会报告未运行，绝不会作为通过证据。

两个远端 Loader 文件都要求 `DSH_AWIKI_USER_SERVICE_URL`、`DSH_AWIKI_USER_SERVICE_DOMAIN`、`DSH_AWIKI_MESSAGE_SERVICE_URL`、`DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL` 和 `DSH_AWIKI_MESSAGE_SERVICE_DID`。主身份与 peer 的 state path 相互独立。State 文件包含凭证，不能提交、写入报告或暴露给浏览器。
