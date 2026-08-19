# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This Electron distribution starts the existing `dsh web` application as an owned loopback child process and displays it in a sandboxed Electron window. The standard Web profile includes `@awiki/dsh-plugin` by default, so AWiki identity, messaging, and model onboarding are available on first launch with the public service defaults.

## Local development

```sh
pnpm --filter deepseek-harness-electron start:dev
```

This command builds and starts the desktop application with DSH state under `.dev-state/dsh`, AWiki identity and message state under `.dev-state/awiki-im-core`, Electron cookies, preferences, caches, and browser storage under `.dev-state/electron`, and the repository root as the default agent workspace. The ignored `.dev-state` directory keeps all development data separate from the installed application's data, so the installed application does not need to be removed.

To test an unpublished packed plugin without changing committed dependencies, create the ignored `.dev-package-overrides.json` at the repository root. It maps each CLI dependency to an absolute archive path or a path relative to the configuration file:

```json
{
  "@scope/plugin": ".dev-package-overrides/archives/plugin.tgz"
}
```

`start:dev` builds the workspace first, then validates and mounts each packed package immediately before Electron starts. The override resolves declared dependencies from the installed public package's locked closure and the CLI workspace, so run `pnpm install --frozen-lockfile` once if that package is not installed. A missing configuration uses the public dependencies; invalid JSON, undeclared package names, missing archives, archive package-name mismatches, and missing installed dependencies stop the launch. Extracted packages and their generated dependency links remain under the ignored `.dev-package-overrides/` directory, separate from `.dev-state`, so clearing first-run application data does not discard package overrides. Manifests, the lockfile, normal `start` launches, and release packaging commands continue to use public dependencies.

## Build installers

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:mac:x64
pnpm --filter deepseek-harness-electron make:windows
```

The macOS commands produce DMG and ZIP installers for Apple Silicon arm64 and Intel x64 respectively. Formal builds run each command on a native runner matching its target architecture. The Windows command produces an x64 NSIS assisted installer and must run on Windows. Its wizard lets the user choose the installation directory and creates Desktop and Start menu shortcuts. All commands build DSH, verify that the Electron main process has no unpackaged runtime dependencies, stage the production runtime for an explicit platform and architecture, rebuild native modules for Electron's ABI, archive that runtime as one installer-safe resource, and generate platform icons. macOS builds also verify the outer executable and every staged Mach-O file against the requested architecture, compare runtime provenance with the build mode, and check the DMG and ZIP containers. The DMG volume icon uses the product icon. On first launch the shell atomically extracts the versioned runtime under Electron's user-data directory and reuses it on subsequent launches.

Use an explicit `:local` command only when an installer must contain the packed archives from `.dev-package-overrides.json`:

```sh
pnpm --filter deepseek-harness-electron make:mac:local
pnpm --filter deepseek-harness-electron make:mac:x64:local
```

These commands require at least one configured archive, require every non-optional dependency and peer to exist in the lockfile-derived staged runtime, and never install an additional dependency while packaging. The runtime records the target, packed archive SHA-256, package version, and installed package digest; post-build verification compares those values with the current configuration and packaged files. The commands without `:local` ignore `.dev-package-overrides.json` and reject an artifact that unexpectedly contains a local override.

An Apple Silicon Mac can create an unsigned Intel integration-test installer directly. The packaging pipeline passes the x64 target explicitly to every target-sensitive stage, so the host Node process remains native arm64:

```sh
pnpm --filter deepseek-harness-electron make:mac:x64:local
```

The Intel DMG is written to `experiments/electron/out/make/DeepSeek Harness-0.1.1-x64.dmg`; the ZIP is under `experiments/electron/out/make/zip/darwin/x64/`. `package:mac:x64:local` performs the same staging and architecture checks but stops at the unpacked `.app`, while `make:mac:x64:local` also creates and verifies the DMG and ZIP.

The `Desktop installers` GitHub Actions workflow runs the same commands on native runners. Start it with `Run workflow` to build the installers manually. The Windows job verifies the installer configuration and bundled `@awiki/dsh-plugin` version, publishes the EXE size and SHA-256 in the run summary, and uploads the EXE as the `deepseek-harness-windows-x64` artifact for 14 days.

Local builds remain unsigned when Apple credentials are absent. A release build signs every Mach-O file inside the compressed production runtime with hardened runtime and a secure timestamp before signing the app and DMG with the same `Developer ID Application` identity. It submits and staples the app, then separately submits the final DMG container, staples its ticket, and verifies its Developer ID signature, Gatekeeper install assessment, disk-image checksum, read-only mount, product volume icon, and application bundle when `DSH_MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are all set; partial credentials fail the build. CI imports the password-protected P12 from `MACOS_CERTIFICATE_P12_BASE64` and `MACOS_CERTIFICATE_PASSWORD` into a temporary keychain and deletes that keychain after packaging. The certificate and private key belong in repository secrets, never in source control. Windows code signing, automatic updates, crash reporting, and replacing the loopback transport with a scoped IPC carrier remain release-hardening work.
