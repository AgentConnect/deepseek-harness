import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const RETAINED_MACOS_LOCALES = new Set(['en.lproj', 'en_GB.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

/** Retain only product-supported Electron locale bundles before signing. */
export async function pruneElectronLocales(buildPath: string, platform: string): Promise<void> {
  if (platform !== 'darwin') return
  const resources = join(
    buildPath,
    'Electron.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  )
  for (const entry of await readdir(resources, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.lproj') && !RETAINED_MACOS_LOCALES.has(entry.name)) {
      await rm(join(resources, entry.name), { recursive: true, force: true })
    }
  }
}
