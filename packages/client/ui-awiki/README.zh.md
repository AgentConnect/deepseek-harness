# @deepseek-ai/dsh-client-ui-awiki

[English](README.md) | 中文

用于部署唯一 AWiki 身份的浏览器插件。它向全框架的 `shell.overlay` 列表贡献 `awiki` 条目：右侧触发按钮会打开一个抽屉，用户可在其中注册身份、查看私聊和已有群聊、读取分页历史、发送文本，以及一次发送一个附件。

这个可选插件在激活时先挂载生成的 AWiki Remote contribution，再声明 slot 条目；卸载会同时撤销该条目与 Remote。因此插件不存在时，常驻 API Remote bundle 不会公开 AWiki namespace。浏览器只调用 `ctx.remote.awiki`。`AwikiController` 将 Typert 载体失败和 AWiki 业务失败统一转换为可安全展示的消息；凭据、token、SDK 状态和附件校验仍留在 Host。下载得到的 base64 字节直接进入临时浏览器 `Blob`，不会写入控制器快照或根作用域交互存储。

Host 通过 `awiki.getConfig` 提供 `pollIntervalMs` 和 `attachmentMaxBytes`。抽屉打开时先加载该策略、身份与会话，再启动定时器。文件选择器会在读入 Base64 之前拒绝超过 Host 上限的文件。抽屉关闭或插件卸载会停止定时器并使进行中的刷新失效。策略缺失或加载失败时，抽屉显示不可用，不会选择客户端默认值。

根作用域存储只持有抽屉是否打开。AWiki 身份、会话和消息保留在无 React 依赖的控制器中。组件通过 slot 系统注入的 observable 钩子接收控制器，不会访问 Cordis ctx。

## 模型体验

无。该浏览器插件不注册提示词、工具 schema、消息或 Session 事件；所有面向模型的 AWiki 操作均由 Host AWiki 插件负责。

#### KV Cache 影响

无；通过抽屉打开、轮询、注册或收发消息都不会改变模型请求。

## 已知限制与暂缓事项

- **仅在打开时轮询** —— 其他标签页与已关闭抽屉不会收到实时更新；实时 WebSocket 或 SSE 投递暂缓实现。
- **单个部署身份** —— 抽屉不能切换身份、恢复其他设备或隔离多个浏览器用户；这些操作需要未来的 Host 身份模型。
- **仅支持已有会话** —— 抽屉可读取私聊和已有群聊，但不能创建群或管理成员。
- **单个内存附件** —— 浏览器会先检查 Host 持有的大小上限，再读取一个所选文件；流式和可恢复传输暂缓实现。
