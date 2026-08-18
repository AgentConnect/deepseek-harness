import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDevelopmentPackageOverrides } from './dev-package-overrides.mjs'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

function resultStatus(result) {
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

/**
 * Build the workspace, mount configured local package archives, and launch the
 * state-isolated Electron development application.
 *
 * @param {object} [options] - Runtime substitutions used by the focused launcher test.
 * @param {string} [options.repositoryRoot] - Absolute repository root.
 * @param {NodeJS.Platform} [options.platform] - Host platform used to select the pnpm executable.
 * @param {NodeJS.ProcessEnv} [options.environment] - Parent process environment.
 * @param {typeof spawnSync} [options.spawn] - Synchronous child-process launcher.
 * @param {typeof applyDevelopmentPackageOverrides} [options.applyOverrides] - Package override applicator.
 * @returns {Promise<number>} The build failure or Electron process exit status.
 */
export async function startDevelopmentApplication({
  repositoryRoot: root = repositoryRoot,
  platform = process.platform,
  environment = process.env,
  spawn = spawnSync,
  applyOverrides = applyDevelopmentPackageOverrides,
} = {}) {
  const command = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const build = spawn(command, ['--dir', root, 'run', 'build'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  })
  const buildStatus = resultStatus(build)
  if (buildStatus !== 0) return buildStatus

  await applyOverrides({ repositoryRoot: root })

  const launch = spawn(command, ['--filter', 'deepseek-harness-electron', 'start:built'], {
    cwd: root,
    env: {
      ...environment,
      DSH_HOME: join(root, '.dev-state', 'dsh'),
      DSH_AWIKI_STATE_ROOT: join(root, '.dev-state', 'awiki-im-core'),
      DSH_ELECTRON_USER_DATA: join(root, '.dev-state', 'electron'),
      DSH_ELECTRON_WORKSPACE: environment.DSH_ELECTRON_WORKSPACE ?? root,
      NODE_USE_ENV_PROXY: environment.NODE_USE_ENV_PROXY ?? '1',
    },
    stdio: 'inherit',
  })
  return resultStatus(launch)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await startDevelopmentApplication()
}
