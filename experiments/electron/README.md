# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This Electron distribution starts the existing `dsh web` application as an owned loopback child process and displays it in a sandboxed Electron window. The standard Web profile includes `dsh-awiki` by default, so AWiki is available on first launch with the public `awiki.ai` service defaults.

## Build installers

```sh
pnpm --filter deepseek-harness-electron make:mac
pnpm --filter deepseek-harness-electron make:windows
```

The macOS command produces an arm64 DMG and ZIP. The Windows command produces an x64 Squirrel Setup EXE and must run on Windows. Both commands build DSH, verify that the Electron main process has no unpackaged runtime dependencies, stage the production runtime, rebuild native modules for Electron's ABI, archive that runtime as one installer-safe resource, and generate platform icons. The DMG volume icon uses the product icon. On first launch the shell atomically extracts the versioned runtime under Electron's user-data directory and reuses it on subsequent launches.

Local builds remain unsigned when Apple credentials are absent. A release build signs the app and DMG with a `Developer ID Application` identity and submits the app for Apple notarization when `DSH_MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are all set; partial credentials fail the build. CI imports the password-protected P12 from `MACOS_CERTIFICATE_P12_BASE64` and `MACOS_CERTIFICATE_PASSWORD` into a temporary keychain and deletes that keychain after packaging. The certificate and private key belong in repository secrets, never in source control. Windows code signing, automatic updates, crash reporting, and replacing the loopback transport with a scoped IPC carrier remain release-hardening work.
