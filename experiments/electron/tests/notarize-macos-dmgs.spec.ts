import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findDmgs, notarizeMacDmgs, validateMountedDmg } from '../scripts/notarize-macos-dmgs.mjs'

const temporaryDirectories: string[] = []

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notarize-dmg-test-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'nested'), { recursive: true })
  const first = join(root, 'DeepSeek Harness-arm64.dmg')
  const second = join(root, 'nested', 'DeepSeek Harness-x64.dmg')
  await writeFile(first, 'arm64')
  await writeFile(second, 'x64')
  await writeFile(join(root, 'nested', 'release.zip'), 'zip')
  return { root, first, second }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('macOS DMG notarization', () => {
  it('submits, staples, verifies, and mounts every final DMG container', async () => {
    const { root, first, second } = await createFixture()
    const calls: Array<{ file: string, args: string[] }> = []
    const inspectedMounts: string[] = []
    const environment = {
      APPLE_ID: 'release@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAM123456',
    }
    const run = async (file: string, args: string[]) => { calls.push({ file, args }) }
    const inspectMount = async (mountPoint: string) => { inspectedMounts.push(mountPoint) }

    expect(await findDmgs(root)).toEqual([first, second])
    await expect(notarizeMacDmgs({ root, platform: 'darwin', environment, run, inspectMount }))
      .resolves.toEqual([first, second])

    for (const dmg of [first, second]) {
      expect(calls).toContainEqual({
        file: 'xcrun',
        args: [
          'notarytool', 'submit', dmg,
          '--apple-id', environment.APPLE_ID,
          '--password', environment.APPLE_APP_SPECIFIC_PASSWORD,
          '--team-id', environment.APPLE_TEAM_ID,
          '--wait',
        ],
      })
      expect(calls).toContainEqual({ file: 'xcrun', args: ['stapler', 'staple', dmg] })
      expect(calls).toContainEqual({ file: 'xcrun', args: ['stapler', 'validate', dmg] })
      expect(calls).toContainEqual({ file: 'codesign', args: ['--verify', '--check-notarization', '--verbose=2', dmg] })
      expect(calls).toContainEqual({ file: 'spctl', args: ['--assess', '--type', 'install', '--verbose=2', dmg] })
      expect(calls).toContainEqual({ file: 'hdiutil', args: ['verify', dmg] })

      const attach = calls.find(call => call.file === 'hdiutil' && call.args.at(-1) === dmg && call.args[0] === 'attach')
      expect(attach).toBeDefined()
      const mountPoint = attach?.args.at(-2)
      expect(mountPoint).toBeTruthy()
      expect(inspectedMounts).toContain(mountPoint)
      expect(calls).toContainEqual({ file: 'hdiutil', args: ['detach', mountPoint!] })
    }
  })

  it('requires the mounted product icon and an application bundle directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mounted-dmg-test-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, '.VolumeIcon.icns'), 'icon')
    await mkdir(join(root, 'DeepSeek Harness.app'))
    await expect(validateMountedDmg(root)).resolves.toBeUndefined()

    await rm(join(root, '.VolumeIcon.icns'))
    await expect(validateMountedDmg(root)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(root, '.VolumeIcon.icns'), 'icon')
    await rm(join(root, 'DeepSeek Harness.app'), { recursive: true })
    await writeFile(join(root, 'DeepSeek Harness.app'), 'not-a-directory')
    await expect(validateMountedDmg(root)).rejects.toThrow('application bundle is not a directory')
  })

  it('fails before submission when credentials or DMG output are missing', async () => {
    const { root } = await createFixture()
    await expect(notarizeMacDmgs({ root, platform: 'darwin', environment: {} }))
      .rejects.toThrow('DMG notarization credentials are incomplete')

    const empty = await mkdtemp(join(tmpdir(), 'dsh-notarize-empty-test-'))
    temporaryDirectories.push(empty)
    await expect(notarizeMacDmgs({
      root: empty,
      platform: 'darwin',
      environment: {
        APPLE_ID: 'release@example.com',
        APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
        APPLE_TEAM_ID: 'TEAM123456',
      },
    })).rejects.toThrow('No DMG files found')
  })

  it('does nothing on non-macOS hosts', async () => {
    await expect(notarizeMacDmgs({ root: '/missing', platform: 'win32' })).resolves.toEqual([])
  })
})
