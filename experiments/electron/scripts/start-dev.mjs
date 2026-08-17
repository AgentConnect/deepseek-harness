import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(command, ['--filter', 'deepseek-harness-electron', 'start'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    DSH_HOME: join(repositoryRoot, '.dev-state', 'dsh'),
    DSH_AWIKI_STATE_ROOT: join(repositoryRoot, '.dev-state', 'awiki-im-core'),
    DSH_ELECTRON_USER_DATA: join(repositoryRoot, '.dev-state', 'electron'),
    DSH_ELECTRON_WORKSPACE: process.env.DSH_ELECTRON_WORKSPACE ?? repositoryRoot,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1',
  },
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
