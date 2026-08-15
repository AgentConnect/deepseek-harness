import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface DesktopInstallerMatrixEntry {
  artifact: string
  command: string
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
) as { scripts: Record<string, string> }
const workflow = load(
  readFileSync(new URL('../../../.github/workflows/desktop-installers.yml', import.meta.url), 'utf8'),
) as DesktopInstallerWorkflow

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
})
