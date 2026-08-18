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

describe('desktop installer architecture matrix', () => {
  it('keeps separate native macOS commands for Apple Silicon and Intel', () => {
    expect(electronManifest.scripts['make:mac']).toContain('--platform=darwin --arch=arm64')
    expect(electronManifest.scripts['make:mac:x64']).toContain('--platform=darwin --arch=x64')
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
