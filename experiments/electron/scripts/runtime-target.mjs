/** Parse and validate the platform and architecture owned by one runtime build. */

const TARGET_ARCHITECTURES = new Map([
  ['darwin', new Set(['arm64', 'x64'])],
  ['win32', new Set(['x64'])],
])

/**
 * Parse runtime staging arguments without falling back to the host process.
 * @param {string[]} args - Command-line arguments.
 * @returns {{platform: 'darwin' | 'win32', arch: 'arm64' | 'x64', localOverrides: boolean}} Validated target.
 */
export function parseRuntimeTarget(args) {
  let platform
  let arch
  let localOverrides = false

  for (const argument of args) {
    if (argument.startsWith('--platform=')) {
      if (platform !== undefined) throw new Error('runtime target platform was provided more than once')
      platform = argument.slice('--platform='.length)
    } else if (argument.startsWith('--arch=')) {
      if (arch !== undefined) throw new Error('runtime target architecture was provided more than once')
      arch = argument.slice('--arch='.length)
    } else if (argument === '--local-overrides') {
      if (localOverrides) throw new Error('runtime local overrides were enabled more than once')
      localOverrides = true
    } else {
      throw new Error(`unknown runtime staging argument: ${argument}`)
    }
  }

  if (platform === undefined || arch === undefined) {
    throw new Error('runtime staging requires --platform=<platform> and --arch=<architecture>')
  }
  const architectures = TARGET_ARCHITECTURES.get(platform)
  if (architectures === undefined || !architectures.has(arch)) {
    throw new Error(`unsupported runtime target: ${platform}-${arch}`)
  }
  return { arch, localOverrides, platform }
}
