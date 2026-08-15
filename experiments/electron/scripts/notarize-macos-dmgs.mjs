import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** @param {string} root @returns {Promise<string[]>} */
export async function findDmgs(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const matches = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) matches.push(...await findDmgs(path))
    else if (entry.isFile() && entry.name.endsWith('.dmg')) matches.push(path)
  }
  return matches.sort()
}

/**
 * @param {{
 *   root: string,
 *   environment?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   run?: (file: string, args: string[]) => Promise<unknown>,
 * }} options
 * @returns {Promise<string[]>}
 */
export async function notarizeMacDmgs({
  root,
  environment = process.env,
  platform = process.platform,
  run = exec,
}) {
  if (platform !== 'darwin') return []

  const credentials = {
    appleId: environment.APPLE_ID?.trim() ?? '',
    password: environment.APPLE_APP_SPECIFIC_PASSWORD?.trim() ?? '',
    teamId: environment.APPLE_TEAM_ID?.trim() ?? '',
  }
  const missing = Object.entries(credentials).filter(([, value]) => value === '').map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`DMG notarization credentials are incomplete: missing ${missing.join(', ')}`)
  }

  const dmgs = await findDmgs(root)
  if (dmgs.length === 0) throw new Error(`No DMG files found below ${root}`)

  for (const dmg of dmgs) {
    await run('xcrun', [
      'notarytool', 'submit', dmg,
      '--apple-id', credentials.appleId,
      '--password', credentials.password,
      '--team-id', credentials.teamId,
      '--wait',
    ])
    await run('xcrun', ['stapler', 'staple', dmg])
    await run('xcrun', ['stapler', 'validate', dmg])
    await run('codesign', ['--verify', '--check-notarization', '--verbose=2', dmg])
    await run('spctl', ['--assess', '--type', 'install', '--verbose=2', dmg])
    await run('hdiutil', ['verify', dmg])

    const mountPoint = await mkdtemp(join(tmpdir(), 'dsh-notarized-dmg-'))
    let mounted = false
    try {
      await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
      mounted = true
      await run('/usr/bin/test', ['-e', join(mountPoint, '.VolumeIcon.icns')])
      await run('/usr/bin/test', ['-d', join(mountPoint, 'DeepSeek Harness.app')])
    } finally {
      if (mounted) await run('hdiutil', ['detach', mountPoint])
      await rm(mountPoint, { recursive: true, force: true })
    }
  }
  return dmgs
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await notarizeMacDmgs({ root: process.argv[2] ?? 'out/make' })
}
