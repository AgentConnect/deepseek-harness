import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findMachOBinaries, signMacRuntime } from '../scripts/sign-macos-runtime.mjs'

const temporaryDirectories: string[] = []

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sign-runtime-test-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'native', 'nested'), { recursive: true })
  const executable = join(root, 'native', 'rg')
  const addon = join(root, 'native', 'nested', 'pty.node')
  const text = join(root, 'native', 'README.md')
  await writeFile(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x01]))
  await writeFile(addon, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x02]))
  await writeFile(text, '# not native\n')
  await symlink(executable, join(root, 'native', 'rg-link'))
  return { root, executable, addon }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('staged macOS runtime signing', () => {
  it('finds only real Mach-O payloads and signs each with hardened runtime and a secure timestamp', async () => {
    const { root, executable, addon } = await createFixture()
    const calls: Array<{ file: string, args: string[] }> = []
    const identity = 'Developer ID Application: AgentConnect (TEAM123456)'

    expect(await findMachOBinaries(root)).toEqual([addon, executable])
    await expect(signMacRuntime({
      root,
      platform: 'darwin',
      environment: {
        DSH_MACOS_SIGN_IDENTITY: identity,
        DSH_MACOS_KEYCHAIN: '/tmp/release.keychain-db',
      },
      run: async (file, args) => {
        calls.push({ file, args })
      },
    })).resolves.toEqual([addon, executable])

    expect(calls).toEqual([
      {
        file: 'codesign',
        args: [
          '--force', '--timestamp', '--options', 'runtime', '--sign', identity,
          '--keychain', '/tmp/release.keychain-db', addon,
        ],
      },
      {
        file: 'codesign',
        args: [
          '--force', '--timestamp', '--options', 'runtime', '--sign', identity,
          '--keychain', '/tmp/release.keychain-db', executable,
        ],
      },
    ])
  })

  it('keeps non-macOS and unsigned local runtime staging unchanged', async () => {
    const { root } = await createFixture()
    const run = async () => {
      throw new Error('codesign must not run')
    }

    await expect(signMacRuntime({ root, platform: 'linux', run })).resolves.toEqual([])
    await expect(signMacRuntime({ root, platform: 'darwin', environment: {}, run })).resolves.toEqual([])
  })

  it('fails a required distribution build before archiving an unsigned runtime', async () => {
    const { root } = await createFixture()
    await expect(signMacRuntime({
      root,
      platform: 'darwin',
      environment: { DSH_REQUIRE_MACOS_SIGNING: '1' },
    })).rejects.toThrow('DSH_MACOS_SIGN_IDENTITY is missing')
  })
})
