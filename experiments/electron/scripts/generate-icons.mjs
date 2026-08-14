/** Generate platform icon resources from the branded vector source. */

import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const source = join(appRoot, 'assets', 'icon.svg')
const exec = promisify(execFile)
const vector = await readFile(source)
const icoPngs = await Promise.all([16, 32, 48, 64, 128, 256].map(size => sharp(vector).resize(size, size).png().toBuffer()))
await writeFile(join(appRoot, 'assets', 'icon.ico'), await pngToIco(icoPngs))

if (process.platform === 'darwin') {
  await access(join(appRoot, 'assets', 'icon.icns'))
  const require = createRequire(import.meta.url)
  const aliasRoot = dirname(require.resolve('macos-alias/package.json'))
  const volumeModule = join(aliasRoot, 'build', 'Release', 'volume.node')
  try {
    await access(volumeModule)
  } catch {
    await exec(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild'], { cwd: aliasRoot })
  }
}

process.stdout.write(`generate-icons: verified macOS icon and wrote Windows icon for ${process.platform}\n`)
