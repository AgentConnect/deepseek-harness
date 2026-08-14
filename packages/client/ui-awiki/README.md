# @deepseek-ai/dsh-client-ui-awiki

English | [中文](README.zh.md)

Browser plugin for the deployment's one AWiki identity. It contributes the `awiki` entry to the frame-wide `shell.overlay` list: a right-side trigger opens a drawer for identity registration, direct and existing group conversations, paginated history, text messages, and one attachment at a time.

On activation, this optional plugin mounts the generated AWiki Remote contribution before it declares the slot entry; unload withdraws the entry and Remote together. The always-on API Remote bundle therefore exposes no AWiki namespace when this plugin is absent. The browser calls only `ctx.remote.awiki`. `AwikiController` flattens Typert carrier failures and AWiki business failures into display-safe messages, while credentials, tokens, SDK state, and attachment verification remain on the Host. Downloaded base64 bytes pass directly into a temporary browser `Blob`; they never enter the controller snapshot or the root-scoped interaction store.

The Host supplies `pollIntervalMs` and `attachmentMaxBytes` through `awiki.getConfig`. Opening the drawer loads that policy, identity, and conversations before starting the timer. The file picker rejects a selected file above the Host limit before reading it into Base64. Closing the drawer or unloading the plugin stops the timer and invalidates in-flight refreshes. A missing or failed policy leaves the drawer unavailable instead of selecting a client-side default.

The root-scoped store owns only whether the drawer is open. AWiki identity, conversations, and messages remain in the React-free controller. Components receive the controller through the slot system's injected observable hook and never access Cordis ctx.

## Model Experience

None, as this browser plugin registers no prompt, tool schema, message, or Session event; the Host AWiki plugin owns every model-facing AWiki operation.

#### KV Cache effect

None; opening, polling, registering, or messaging through the drawer does not alter a model request.

## Known Limitations and Deferred Work

- **Polling only while open** — other tabs and closed drawers receive no live update; realtime WebSocket or SSE delivery is deferred.
- **One deployment identity** — the drawer cannot switch identities, recover another device, or isolate several browser users; those operations require a future Host identity model.
- **Existing conversations only** — the drawer reads direct chats and existing groups but cannot create a group or manage membership.
- **One in-memory attachment** — the browser checks the Host-owned limit before reading one selected file; streaming and resumable transfers are deferred.
