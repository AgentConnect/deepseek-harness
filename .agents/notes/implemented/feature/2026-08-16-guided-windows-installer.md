# Agent Note: Guided Windows installer

Status: implemented

English | [中文](2026-08-16-guided-windows-installer.zh.md)

## Problem

The Windows Squirrel installer chooses its own installation location and does not provide the conventional wizard expected by desktop users. Its generated shortcuts and the application's custom wave icon also make the installed product difficult to identify.

## Decision

Windows releases use electron-builder's assisted NSIS target. The installer exposes the installation-directory page, creates Desktop and Start menu shortcuts, and offers to launch DeepSeek Harness after installation. macOS packaging remains on Electron Forge because its DMG, ZIP, signing, and notarization flow has different platform requirements.

The Windows executable, installer, uninstaller, and shortcuts use an ICO generated from the official DeepSeek whale vector on the product blue background. The icon generator emits the standard Windows sizes from 16 through 256 pixels from one SVG source.

The desktop distribution test reads the package manifest and GitHub Actions workflow, then pins the Windows runner, uploaded EXE path, assisted mode, directory selection, both shortcut types, NSIS command, and Windows icon path. The Windows job verifies the built installer and bundled `@awiki/dsh-plugin` version, writes the EXE size and SHA-256 to the run summary, and retains the uploaded artifact for 14 days.

## Alternatives considered

**Keep Squirrel.** This would avoid another packaging dependency, but Squirrel does not provide the installation-directory selection required by the desktop workflow.

**Use one-click NSIS.** It retains NSIS packaging but removes the installation choices that motivated the change.

**Use WiX MSI.** MSI is familiar to managed Windows environments, but it adds a larger Windows-specific toolchain without improving the requested assisted installation flow.

## Consequences

Windows users receive a conventional installation wizard and predictable entry points in the Desktop and Start menu. The Windows build adds electron-builder and its NSIS toolchain to the dependency lock. Windows packages remain unsigned, so SmartScreen warnings are still possible until code signing is configured.
