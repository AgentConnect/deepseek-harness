# Agent Note: AWiki-enabled Electron distribution

Status: implemented

English | [中文](2026-08-15-awiki-electron-distribution.zh.md)

## Problem

The standalone AWiki plugin needs a default DeepSeek Harness composition and reproducible desktop installers. The existing Web profile is the authoritative application surface, while native modules require Electron-specific ABI rebuilding on each target operating system.

## Decision

Add the released canonical `@awiki/dsh-plugin` bundle to the shipped Web profile after the Web application layer. Migrate only the exact previous stock tuple containing the retired `@awiki/dsh` name; existing customized profile bundle lists remain unchanged. Expose the plugin's `awiki` settings namespace through the product settings API.

Promote the prior loopback Electron acceptance shell into a cross-platform distribution. It owns the existing CLI Host as a child process, loads only its canonical `127.0.0.1` origin in a sandboxed renderer, and rebuilds native modules for the target Electron ABI. The build bundles every main-process dependency except Electron and rejects a generated entrypoint that retains another bare package import. It stores the production dependency closure as one compressed resource so installer tooling never needs to enumerate deep third-party dependency paths. First launch atomically extracts a versioned runtime under Electron user data; later launches reuse the validated extraction. GitHub Actions builds arm64 and Intel x64 macOS DMG/ZIP installers plus the x64 Windows NSIS assisted installer on native runners matching each target architecture.

The repository development launcher places DSH state, AWiki IM state, and Electron-owned cookies, preferences, cache, and browser storage in separate ignored directories under `.dev-state`. The Electron path override is accepted only as an absolute path, is applied before `app.whenReady()`, and is absent from normal installed launches, so development and installed application state do not overlap. An ignored machine-local configuration may map declared CLI dependencies to packed npm archives. The launcher builds first, validates and extracts each archive into an ignored content-addressed directory, generates exact dependency links from the installed public package closure and CLI workspace, and then atomically mounts it at the CLI resolver path before Electron starts. Missing configuration retains public dependencies, while malformed configuration, missing archives, undeclared or uninstalled packages, incomplete dependency resolution, and package-name mismatches fail the launch. Normal launches, manifests, lockfiles, and installers never consume these overrides.

macOS release credentials are an all-or-nothing build input. Before the production runtime is compressed, every staged Mach-O executable, native addon, and dynamic library is signed with hardened runtime and a secure timestamp; this is required because Electron Packager can sign the enclosing app but cannot see native code inside the runtime archive. The same `Developer ID Application` identity signs the app and DMG. Apple ID notarization credentials submit and staple the app during packaging, then submit the final DMG as a separate notarization object, staple its ticket, and gate artifact upload on `codesign`, `stapler`, Gatekeeper install assessment, image checksum verification, and a real read-only mount that checks the product volume icon and application bundle. CI imports the P12 into a temporary keychain that it deletes after packaging. The import grants signing access to the private key, adds the temporary keychain to the runner's user search list, and rejects a P12 that does not expose the configured identity. Builds without credentials remain available for local and pull-request validation, while partial credentials or a non-distribution identity fail. The DMG explicitly uses the product ICNS as its mounted-volume icon.

## Alternatives considered

- Keeping AWiki as an opt-in profile was rejected because the requested product behavior is default availability for new installations.
- Rewriting every existing profile was rejected because customized bundle lists are user-owned configuration.
- Shipping a separate desktop implementation was rejected because it would duplicate Host, Web, persistence, and plugin behavior.
- Cross-compiling the Windows installer on macOS was rejected in favor of rebuilding native dependencies on a native Windows runner.
- Shipping the runtime as thousands of loose extra-resource files was rejected because valid transitive SDK filenames exceed Squirrel's NuGet path limit before the EXE can be created.
- Committing an Apple certificate was rejected because the repository must never contain its private key; CI receives it through encrypted repository secrets and uses an ephemeral keychain.
- Falling back to an Apple Development identity was rejected because it does not establish a public Developer ID distribution accepted by Gatekeeper.
- Recording local tarball paths in the manifest or lockfile was rejected because machine-specific development inputs must not affect reproducible installation and release artifacts.

## Consequences

- New and exact-stock Web profiles include AWiki without a separate plugin command; customized profiles are not rewritten.
- macOS and Windows packages exercise the same Host, Web UI, profile, persistence, and plugin contracts as the CLI.
- The first launch performs one trusted archive extraction; a marker tied to archive size makes reuse explicit and an incomplete extraction is never published as the active runtime.
- macOS release builds become signed and notarized as soon as the complete Developer ID secret set is present; validation builds stay explicitly unsigned when it is absent.
- The mounted DMG uses the DeepSeek Harness volume icon instead of the installer dependency's Electron default.
- The repository development launcher does not read or write the installed application's DSH, AWiki, or Electron user-data directories.
- Unpublished plugin builds can replace declared CLI dependencies for one development checkout without changing the public dependency graph or being packaged into installers.
- The loopback listener remains local-only; a future scoped IPC carrier can replace it without changing the profile or AWiki package.
