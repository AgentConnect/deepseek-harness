import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface DesktopInstallerMatrixEntry {
  artifact: string
  command: string
  path: string
  runner: string
}

interface DesktopInstallerWorkflow {
  jobs?: {
    build?: {
      strategy?: {
        matrix?: {
          include?: DesktopInstallerMatrixEntry[]
        }
      }
    }
  }
}

const electronManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  build: {
    nsis: Record<string, boolean | string>
    win: { icon: string }
  }
  scripts: Record<string, string>
}
const cliManifest = JSON.parse(readFileSync(new URL('../../../apps/cli/package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>
}
const workflowText = readFileSync(new URL('../../../.github/workflows/desktop-installers.yml', import.meta.url), 'utf8')
const workflow = load(workflowText) as DesktopInstallerWorkflow
const stageRuntimeText = readFileSync(new URL('../scripts/stage-runtime.mjs', import.meta.url), 'utf8')

describe('desktop installer architecture matrix', () => {
  it('keeps separate native macOS commands for Apple Silicon and Intel', () => {
    expect(electronManifest.scripts['make:mac']).toContain('--platform=darwin --arch=arm64')
    expect(electronManifest.scripts['make:mac:x64']).toContain('--platform=darwin --arch=x64')
    expect(electronManifest.scripts['make:mac']).not.toContain('--local-overrides')
    expect(electronManifest.scripts['make:mac:x64']).not.toContain('--local-overrides')
  })

  it('offers explicit local-package installers without changing release commands', () => {
    expect(electronManifest.scripts['make:mac:local']).toContain('--platform=darwin --arch=arm64 --local-overrides')
    expect(electronManifest.scripts['make:mac:x64:local']).toContain('--platform=darwin --arch=x64 --local-overrides')
    expect(electronManifest.scripts['make:mac:local']).toContain('verify-macos-artifacts.mjs')
    expect(electronManifest.scripts['make:mac:x64:local']).toContain('verify-macos-artifacts.mjs')
  })

  it('uses the explicit runtime target for native rebuild, pruning, and signing', () => {
    expect(stageRuntimeText).not.toContain('arch: process.arch')
    expect(stageRuntimeText).not.toContain('pruneRuntime(stagedTarget, process.platform, process.arch)')
    expect(stageRuntimeText).toContain('arch: runtimeTarget.arch')
    expect(stageRuntimeText).toContain('pruneRuntime(stagedTarget, runtimeTarget.platform, runtimeTarget.arch)')
    expect(stageRuntimeText).toContain('platform: runtimeTarget.platform')
    expect(stageRuntimeText).toContain('`--cpu=${runtimeTarget.arch}`')
    expect(stageRuntimeText).toContain('`--os=${runtimeTarget.platform}`')
    expect(stageRuntimeText).toContain("'--ignore-scripts'")
    expect(stageRuntimeText).toContain("'--prod=false'")
  })

  it('builds each macOS architecture on a matching GitHub-hosted runner', () => {
    const entries = workflow.jobs?.build?.strategy?.matrix?.include
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runner: 'macos-14',
        command: 'make:mac',
        artifact: 'deepseek-harness-macos-arm64',
      }),
      expect.objectContaining({
        runner: 'macos-15-intel',
        command: 'make:mac:x64',
        artifact: 'deepseek-harness-macos-x64',
      }),
    ]))
  })

  it('builds a guided Windows installer with product shortcuts', () => {
    const entries = workflow.jobs?.build?.strategy?.matrix?.include
    expect(entries).toContainEqual(expect.objectContaining({
      runner: 'windows-latest',
      command: 'make:windows',
      artifact: 'deepseek-harness-windows-x64',
      path: 'h/experiments/electron/out/make/*.exe',
    }))
    expect(electronManifest.scripts['make:windows']).toContain('electron-builder --win nsis --x64')
    expect(electronManifest.build.win.icon).toBe('assets/icon.ico')
    expect(electronManifest.build.nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
    })
  })

  it('packages the canonical public AWiki plugin and verifies its exact version', () => {
    expect(cliManifest.dependencies['@awiki/dsh-plugin']).toBe('0.2.4')
    expect(cliManifest.dependencies['@awiki/dsh']).toBeUndefined()
    expect(workflowText).toContain("$expectedAwikiVersion = '0.2.4'")
    expect(workflowText).toContain('./node_modules/@awiki/dsh-plugin/package.json')
    expect(workflowText).not.toContain('./node_modules/@awiki/dsh/package.json')
  })
})
