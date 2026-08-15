# Agent Note: AWiki-enabled Electron distribution

Status: implemented

English | [中文](2026-08-15-awiki-electron-distribution.zh.md)

## Problem

The standalone AWiki plugin needs a default DeepSeek Harness composition and reproducible desktop installers. The existing Web profile is the authoritative application surface, while native modules require Electron-specific ABI rebuilding on each target operating system.

## Decision

Add the released `dsh-awiki` bundle to the shipped Web profile after the Web application layer and migrate only the exact previous stock tuple. Existing customized profile bundle lists remain unchanged. Expose the plugin's `awiki` settings namespace through the product settings API.

Promote the prior loopback Electron acceptance shell into a cross-platform distribution. It owns the existing CLI Host as a child process, loads only its canonical `127.0.0.1` origin in a sandboxed renderer, and rebuilds native modules for the target Electron ABI. The build bundles every main-process dependency except Electron and rejects a generated entrypoint that retains another bare package import. It stores the production dependency closure as one compressed resource because Squirrel's NuGet layer cannot enumerate third-party paths beyond its legacy Windows limit. First launch atomically extracts a versioned runtime under Electron user data; later launches reuse the validated extraction. GitHub Actions builds arm64 and Intel x64 macOS DMG/ZIP installers plus the x64 Windows Squirrel Setup EXE on native runners matching each target architecture.

macOS release credentials are an all-or-nothing build input. A `Developer ID Application` identity signs the app and DMG, Apple ID notarization credentials submit and staple the app, and CI imports the P12 into a temporary keychain that it deletes after packaging. The import grants signing access to the private key, adds the temporary keychain to the runner's user search list, and rejects a P12 that does not expose the configured identity. Builds without credentials remain available for local and pull-request validation, while partial credentials or a non-distribution identity fail. The DMG explicitly uses the product ICNS as its mounted-volume icon.

## Alternatives considered

- Keeping AWiki as an opt-in profile was rejected because the requested product behavior is default availability for new installations.
- Rewriting every existing profile was rejected because customized bundle lists are user-owned configuration.
- Shipping a separate desktop implementation was rejected because it would duplicate Host, Web, persistence, and plugin behavior.
- Cross-compiling the Windows installer on macOS was rejected in favor of rebuilding native dependencies on a native Windows runner.
- Shipping the runtime as thousands of loose extra-resource files was rejected because valid transitive SDK filenames exceed Squirrel's NuGet path limit before the EXE can be created.
- Committing an Apple certificate was rejected because the repository must never contain its private key; CI receives it through encrypted repository secrets and uses an ephemeral keychain.
- Falling back to an Apple Development identity was rejected because it does not establish a public Developer ID distribution accepted by Gatekeeper.

## Consequences

- New and exact-stock Web profiles include AWiki without a separate plugin command; customized profiles are not rewritten.
- macOS and Windows packages exercise the same Host, Web UI, profile, persistence, and plugin contracts as the CLI.
- The first launch performs one trusted archive extraction; a marker tied to archive size makes reuse explicit and an incomplete extraction is never published as the active runtime.
- macOS release builds become signed and notarized as soon as the complete Developer ID secret set is present; validation builds stay explicitly unsigned when it is absent.
- The mounted DMG uses the DeepSeek Harness volume icon instead of the installer dependency's Electron default.
- The loopback listener remains local-only; a future scoped IPC carrier can replace it without changing the profile or AWiki package.
