# Agent Note: AWiki messaging uses one deployment identity

Status: implemented

English | [中文](2026-08-13-awiki-unified-agent-messaging.zh.md)

## Problem

Harness Agents need to exchange direct and existing-group messages outside one Harness process while presenting one stable identity to their peers. Giving every Agent an SDK instance would multiply private-key state, permit identity drift between sessions, and make browser registration responsible for credentials. Putting AWiki calls in the browser would also expose the DID key and access token to the least trusted application layer.

The first release needs identity registration, history, text, and one-file attachments without committing the Harness agent loop to one messaging network. It also needs a public deployment model despite the Web application not providing multi-user principal isolation.

## Decision

`@deepseek-ai/dsh-awiki` is a complete capability seam. Its Service Definition owns one deployment-wide client slot and the public DTOs; the TypeScript SDK provider owns AWiki authentication, credentials, persistence, protocol calls, idempotency, and attachment integrity; its Remote and tools are Consumers. The service exposes no identity selector. Every root Agent and subagent in the process therefore reads and sends through the same registered Handle and DID.

The deployment registers that identity through the browser Remote only. Registration is absent from the model tool catalog, and a successful registration cannot replace an existing persisted identity. The MVP uses AWiki's Legacy single-device registration and transport-protected messaging. Manifest devices, recovery, multi-device joins, direct or group E2EE, group creation, and real-time delivery remain outside this capability.

Browser and model values use Host-owned, JSON-safe DTOs. They include public Handle and DID values, conversation and message ids, message content, and attachment display metadata. They exclude private keys, access tokens, object keys, nonces, upload credentials, download tickets, state paths, and complete attachment manifests. The Host converts provider errors to a closed failure vocabulary with fixed public messages, caps decoded attachments at a configurable size, and never returns remote response bodies.

The browser plugin contributes a right-side `shell.overlay` trigger. It calls only the Host Remote, requests registration with Handle, phone, and OTP, and reads the polling interval and attachment limit from a browser-safe Host method. Conversation and selected-history refreshes run only while the drawer is open; closing or unloading the plugin invalidates in-flight work and stops the timer. The browser rejects an oversized file before reading it and retains neither SDK credentials nor attachment bytes in its observable state.

AWiki remains opt-in. `@deepseek-ai/dsh-awiki-web` inserts the Host service, SDK provider, and browser plugin after the ordinary Web bundle; the always-on Web bundle does not mount AWiki or add its SDK dependency. This keeps installations without AWiki unchanged while preserving the required Host-before-provider-before-UI order.

Read-only model tools expose identity status, conversation listing, and history. Text and attachment send tools pass through `tools/pre-execute` and require an approval decision. Tool calls and results use the ordinary logged tool path, so every AWiki value that reaches a model request is reconstructable from the session log. AWiki remains the authoritative chat-history store.

A public installation keeps Harness bound to loopback behind one HTTPS reverse proxy and one authenticated user. The proxy protects the page and every API or streaming route and enforces a request-body limit consistent with the Host attachment limit. SDK state contains plaintext signing keys and access credentials protected by owner-only file permissions; encrypted storage and encrypted backups are deployment requirements, while a credential-vault provider is deferred. Attachment downloads use exact reviewed HTTPS origins, capped response bodies, manifest size checks before authorization, and digest verification. This is a single-user deployment rule, not multi-user isolation: sharing the Web origin shares the AWiki identity and every Harness capability available there.

## Alternatives considered

**One identity per Agent or session.** This gives peers distinct senders and can support per-Agent revocation, but it requires registration, credential selection, storage ownership, and cleanup for every Agent lifecycle. The product requirement is one recognizable deployment identity, so that state would add complexity while producing the wrong external behavior.

**Browser-owned AWiki SDK.** Direct browser calls remove one Host hop, but put the DID private key and token in browser storage and bypass the Harness Remote's redaction, byte limit, and lifecycle ownership. The browser remains a presentation Consumer.

**MCP server integration.** An MCP tool server can expose message operations but does not provide the native browser registration and history surface, and adds another protocol and process lifecycle. The versioned TypeScript SDK is the only AWiki transport dependency.

**Agent-loop integration.** Injecting external messages into the core loop could make AWiki an ambient inbox, but it would change prompt admission and persistence semantics for a capability that can use existing service, Remote, tool, and client extension points. Polling remains an explicit UI read and no unsolicited model turn is created.

**Direct public Web binding.** Binding Harness to all interfaces omits authentication and treats one process-wide capability set as though it were multi-user. Loopback plus an authenticated TLS proxy makes the actual single-user trust model explicit.

## Consequences

- Every Agent in one Harness process has one external Handle and DID; the provider owns exactly one SDK client and disposes it when its plugin unloads.
- Registration and secrets stay outside model tools and browser state, while read and send results remain ordinary, logged tool output when a model invokes them.
- Private chat, existing-group chat, paginated history, text, and one attachment are available through the same service. Group administration and encrypted messaging require later capability work.
- Legacy history uses an opaque, conversation-bound offset cursor for older pages. Concurrent arrivals may shift an offset page, and a fresh Legacy state can discover current unread Direct conversations but cannot reconstruct every previously read Direct conversation; the SDK persists conversations after it observes them.
- The SDK state file is not encrypted by this integration. Mode `0600`, an owner-only parent directory, encrypted storage, encrypted backups, and single-process ownership are operational requirements until credentials move to a vault capability.
- UI polling consumes no background timer while the drawer is closed and does not claim real-time delivery.
- The independently versioned TypeScript SDK is a release prerequisite. A Harness package cannot be installed reproducibly until that SDK version is available from its declared package source.
- A public deployment remains single-user even when the reverse proxy has a login. Per-user identities require authenticated principals and Agent, Session, credential, and storage ownership throughout the Host.
