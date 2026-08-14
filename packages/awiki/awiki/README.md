# @deepseek-ai/dsh-awiki

English | [中文](README.zh.md)

The AWiki Host service binds one deployment-wide identity to browser Remote methods and five model tools. The service consumes a replaceable high-level TypeScript client; `@deepseek-ai/dsh-awiki/provider` registers the production `@anp/typescript-sdk` implementation, while keyless examples may register an effect-owned fake through `registerClientFactory()`.

## Configuration

Load the service before one provider:

```yaml
- id: awiki
  name: '@deepseek-ai/dsh-awiki'
  config:
    userServiceUrl: https://users.awiki.example
    userServiceDomain: awiki.example
    messageServiceUrl: https://messages.awiki.example
    messageServicePublicUrl: https://messages.awiki.example
    messageServiceDid: did:wba:messages.awiki.example
    allowedAttachmentOrigins:
      - https://messages.awiki.example
      - https://peer-home.awiki.example
    statePath: /var/lib/dsh/awiki/identity.json
    attachmentMaxBytes: 10485760
    pollIntervalMs: 3000
- id: awiki-provider
  name: '@deepseek-ai/dsh-awiki/provider'
```

All six SDK connection fields are required. `userServiceDomain` is the Handle provider domain, `messageServiceDid` is the authoritative bare-domain `did:wba` message-service DID, and `messageServicePublicUrl` is the externally reachable base published in that identity's DID document; none is inferred from an API URL. Service URLs must use HTTPS. The source-only `allowInsecureLoopbackForTesting` switch permits HTTP on loopback for local tests and must not be enabled in a public profile. URLs containing credentials or fragments fail at load.

`allowedAttachmentOrigins` is an exact HTTPS origin allowlist for attachment object URLs discovered from sender DID documents. It defaults to the origin of `messageServicePublicUrl`; add every reviewed peer Home origin from which this deployment must download attachments. Paths, queries, duplicates, and non-HTTPS origins fail at load. `attachmentMaxBytes` defaults to 10 MiB, applies inside Host, SDK, and browser preflight, and must be a positive safe integer. `pollIntervalMs` defaults to 3000 and must be an integer from 1000 through 60000. Only the polling interval and attachment limit cross the browser Remote; SDK connection values, origin policy, and state path remain Host-only.

## Service and provider lifecycle

`ctx.awiki` implements the client-safe `AwikiHostClient` operations: public configuration, identity state, Legacy registration OTP and completion, conversations, history, text, attachment upload, and attachment download. Each operation returns `AwikiResult`; the service normalizes SDK failures to fixed public codes and messages and never returns remote bodies, causes, tokens, private keys, upload tickets, or local paths.

`registerClientFactory(factory)` accepts exactly one synchronous high-level client factory and returns an asynchronous disposer. A provider must return that disposer from its own `ctx.effect`. The disposer clears the client slot before awaiting `client.dispose()`, so new operations fail closed while teardown reaches quiescence. The Host service also joins the same idempotent cleanup if it unloads first. Calls made without a provider return the public `remote` failure `AWiki client provider is unavailable.`

Attachment upload accepts canonical standard Base64 and enforces the configured limit on complete decoded bytes before calling the provider. Download relies on the SDK's SHA-256 verification, rechecks byte length against both the deployment limit and returned metadata, and then encodes bytes as Base64 for the Remote. Public attachment data contains only id, name, MIME type, size, and SHA-256.

## Remote and model operations

Only methods marked with `@Remote` enter the Typert projection. `registerClientFactory()` remains same-process. Registration is browser-only and has no model tool.

The model receives five tools: `awiki_identity_status`, `awiki_list_conversations`, `awiki_history`, `awiki_send_message`, and `awiki_send_attachment`. The two send tools return an execution-time `ask` decision from `tools/pre-execute`; the tool registry routes that decision through the configured approval service and denies without a grant. Browser Remote sends are outside the model-tool approval path. Deployment authentication authorizes every browser client that can reach the Remote; the Host does not prove a physical user gesture.

## Model Experience

### AWiki tools

#### What the model sees

The five AWiki schemas and their structured JSON results appear in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-awiki). Read results contain public identity, conversation, message, and attachment fields. Send results appear only after the approval decision permits execution.

#### Token effect

Tool schemas add a fixed request cost while this plugin is mounted. Each invoked result adds data-dependent tokens for the returned page or sent message; attachment results include metadata and Base64 only when the attachment tool arguments or browser operation carry those bytes.

#### KV Cache effect

The stable tool schemas preserve a reusable prompt prefix until the plugin set or schema changes. Tool calls and results append to later request history and do not rewrite the preceding prefix.

## Known Limitations and Deferred Work

- **One deployment identity** — the service has one provider and one persisted identity; multiple users, identity switching, recovery, and multi-device join are outside this package.
- **Polling consumer** — the Host exposes a browser polling interval but owns no WebSocket, SSE, background poller, or automatic Agent wakeup.
- **Existing groups only** — conversation and send methods use existing direct and group targets; group creation and membership management are absent.
- **Legacy Direct discovery** — the SDK combines persisted conversations with the current unread inbox. A fresh state cannot reconstruct Direct conversations that were already read before the SDK observed them. Older-history cursors use Legacy offsets, so concurrent arrivals can shift a page.
- **Single bounded attachment** — each send carries one complete Base64 attachment in memory; streaming and multi-attachment messages are deferred.
- **Transport encryption only** — public service and attachment origins require HTTPS, but Direct E2EE, Group E2EE, MLS, and key rotation are not implemented by this integration.
