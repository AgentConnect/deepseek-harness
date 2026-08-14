# AWiki Agent example

English | [中文](README.zh.md)

This example proves the AWiki plugin through a real Cordis Loader composition without contacting an AWiki deployment. Its fake provider gives two configured Agents the same DID and exercises identity reads, conversation and history reads, approved Direct and existing-group sends, one attachment, and asynchronous provider disposal. The golden snapshot records every model-visible tool call and result and rejects a secret marker.

Run the keyless snapshot from the repository root:

```sh
pnpm exec vitest run --config vitest.snapshot.config.ts examples/awiki-agent/tests/awiki.snapshot.ts
```

`tests/remote-acceptance.ts` is an opt-in real-service runner consumed by `awiki-system-test`. It uses only `@anp/typescript-sdk`; it does not start or call an MCP server. The system test first registers one primary Legacy identity through the runner, provisions an independent peer SDK state and a tracked transport-protected group, and adds the primary as a member. The acceptance phase makes two Harness Agents send through the primary DID, observes Direct and group messages through the peer, verifies downloaded attachment bytes and SHA-256, restarts the primary composition, and writes a closed non-secret report.

The remote runner requires reviewed service configuration plus a phone and OTP supplied only through its process environment. Run it through the `awiki-system-test` scenario rather than invoking it directly; that scenario creates the ephemeral peer and group, records the primary and peer identities and group for cleanup, and supplies their private state and targets only to the acceptance process. Missing remote prerequisites are reported as not run and are never treated as passing evidence.

The two remote Loader files require `DSH_AWIKI_USER_SERVICE_URL`, `DSH_AWIKI_USER_SERVICE_DOMAIN`, `DSH_AWIKI_MESSAGE_SERVICE_URL`, `DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL`, and `DSH_AWIKI_MESSAGE_SERVICE_DID`. The primary and peer state paths remain separate. State files contain credentials and must not be committed, copied into reports, or exposed to a browser.
