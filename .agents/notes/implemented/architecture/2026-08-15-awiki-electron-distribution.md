# Agent Note: AWiki-enabled Electron distribution

Status: implemented

English | [中文](2026-08-15-awiki-electron-distribution.zh.md)

## Problem

The standalone AWiki plugin needs a default DeepSeek Harness composition and reproducible desktop installers. The existing Web profile is the authoritative application surface, while native modules require Electron-specific ABI rebuilding on each target operating system.

## Decision

Add the released `dsh-awiki` bundle to the shipped Web profile after the Web application layer and migrate only the exact previous stock tuple. Existing customized profile bundle lists remain unchanged. Expose the plugin's `awiki` settings namespace through the product settings API.

Promote the prior loopback Electron acceptance shell into a cross-platform distribution. It owns the existing CLI Host as a child process, loads only its canonical `127.0.0.1` origin in a sandboxed renderer, stages the production dependency closure outside ASAR, and rebuilds native modules for the target Electron ABI. GitHub Actions builds the arm64 macOS DMG and x64 Windows Squirrel Setup EXE on native runners.

## Alternatives considered

- Keeping AWiki as an opt-in profile was rejected because the requested product behavior is default availability for new installations.
- Rewriting every existing profile was rejected because customized bundle lists are user-owned configuration.
- Shipping a separate desktop implementation was rejected because it would duplicate Host, Web, persistence, and plugin behavior.
- Cross-compiling the Windows installer on macOS was rejected in favor of rebuilding native dependencies on a native Windows runner.

## Consequences

- New and exact-stock Web profiles include AWiki without a separate plugin command; customized profiles are not rewritten.
- macOS and Windows packages exercise the same Host, Web UI, profile, persistence, and plugin contracts as the CLI.
- The first installers are unsigned. Gatekeeper, SmartScreen, notarization, and trusted publisher identity remain explicit release-hardening work.
- The loopback listener remains local-only; a future scoped IPC carrier can replace it without changing the profile or AWiki package.
