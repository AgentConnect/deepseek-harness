# `@deepseek-ai/dsh-awiki-web`

English | [中文](README.zh.md)

An optional patch-layer bundle that adds one deployment-scoped AWiki identity to a DeepSeek Harness Web profile. Apply it after [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md). Its three ordered rows mount the [`dsh-awiki`](../../awiki/awiki/README.md) Host service, its production TypeScript SDK provider, and the [`dsh-client-ui-awiki`](../../client/ui-awiki/README.md) browser drawer. The bundle does not replace the Web server row, so the Web bundle continues to listen on loopback by default.

## Configuration

Set these values before starting the profile:

| Variable | Meaning | Default |
|---|---|---|
| `DSH_AWIKI_USER_SERVICE_URL` | Absolute AWiki user-service URL | Required |
| `DSH_AWIKI_USER_SERVICE_DOMAIN` | Authoritative Handle provider domain | Required |
| `DSH_AWIKI_MESSAGE_SERVICE_URL` | Absolute AWiki message-service URL | Required |
| `DSH_AWIKI_MESSAGE_SERVICE_DID` | Authoritative message-service DID | Required |
| `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL` | Public message-service protocol endpoint | Required |
| `DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS` | JSON array of exact HTTPS origins for remote attachment objects | `[]` (public message-service origin) |
| `DSH_AWIKI_STATE_PATH` | Private identity state file | Required |
| `DSH_AWIKI_POLL_INTERVAL_MS` | Drawer polling interval in milliseconds | `5000` |
| `DSH_AWIKI_ATTACHMENT_MAX_BYTES` | Maximum decoded attachment size | `10485760` |

`DSH_AWIKI_USER_SERVICE_DOMAIN` is the authoritative Handle provider domain, and `DSH_AWIKI_MESSAGE_SERVICE_DID` is the authoritative message-service DID. Set both from the AWiki provider configuration; neither may be guessed or derived from an API host. `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL` is the endpoint published in protocol records, while `DSH_AWIKI_MESSAGE_SERVICE_URL` is the base URL this process calls; configure them independently even when a deployment assigns the same URL to both. The Host rejects missing or invalid protocol identifiers, malformed numeric values, intervals outside 1,000–60,000 milliseconds, and non-positive or unsafe attachment sizes at activation. All service URLs must use HTTPS. URLs with credentials or fragments are rejected.

Remote DIDs may refer to attachment objects on origins other than the public message service. `DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS` is a JSON string array of the exact HTTPS origins that may serve those objects, including any non-default port and with no path, query, credentials, or fragment. An unset variable passes `[]`, which makes the Host allow only the origin of `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL`; each additional origin must be explicitly listed. Malformed JSON fails profile evaluation, and the Host rejects non-string, duplicate, or invalid entries. This product bundle does not expose the Host's test-only insecure-loopback flag.

Create a custom profile whose manifest lists `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `@deepseek-ai/dsh-awiki-web` in that order. `dsh plugin --profile awiki-web add ...` initializes a missing custom profile with base and appends installed bundle packages in command order; install the Web bundle before this bundle. Then run:

```sh
export DSH_AWIKI_USER_SERVICE_URL=https://user.awiki.example
export DSH_AWIKI_USER_SERVICE_DOMAIN=awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_URL=https://message.awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_DID=did:wba:messages.awiki.example
export DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL=https://message.awiki.example
export DSH_AWIKI_STATE_PATH=/var/lib/dsh-awiki/identity.json
dsh --profile awiki-web
```

## Identity and Messaging Scope

One running deployment owns one registered AWiki identity. Every Harness Agent and every browser session in that process acts as that identity; the drawer supports registration, existing direct and group conversations, history, text messages, and one attachment per message. This is not a multi-user isolation mechanism. A reverse proxy login controls access to the shared deployment identity rather than assigning an AWiki identity to each logged-in person.

The MVP uses AWiki Legacy single-device identity state and transport encryption. Do not run two live deployments from the same state file. Message bodies and attachments are not end-to-end encrypted by this bundle.

## Public Deployment

Keep Harness bound to loopback and place an authenticated HTTPS reverse proxy on the same host. Authentication must cover the page, every API and plugin path, and SSE or WebSocket upgrades; a rule that protects only the HTML route leaves messaging and session operations exposed. Preserve upgrade and streaming headers and reject unauthenticated requests before forwarding them to Harness.

Set the proxy request-body limit above the decoded attachment cap after accounting for base64 expansion and the JSON envelope. With the default 10 MiB attachment limit, choose at least 14 MiB; keep proxy and Host limits aligned when changing `DSH_AWIKI_ATTACHMENT_MAX_BYTES`.

The identity state contains plaintext private signing material and access credentials; this integration does not encrypt the file itself. Keep its parent directory owner-only, let the SDK maintain the file as mode `0600`, place it on encrypted storage, and back it up only to encrypted owner-restricted storage. Stop the deployment before copying or restoring the file, and restore the same permissions before restart.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-awiki`, which owns the AWiki tool schemas and results; this bundle adds no model-bound content of its own.

#### KV Cache effect

The bundle adds no prompt text. The Host's stable tool schemas join the model request for Agents that inherit the deployment tool registry.

## Known Limitations and Deferred Work

- **One trust domain** — all authenticated Web users and all Harness Agents can act as the same AWiki identity; per-user authorization and identities require separate deployments.
- **Polling only** — the drawer refreshes while open and has no push notification channel.
- **Legacy single-device state** — concurrent use of one state file is unsupported, and end-to-end encryption is deferred.
