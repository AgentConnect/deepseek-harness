import type { spawnSync } from 'node:child_process'
import type { applyDevelopmentPackageOverrides } from './dev-package-overrides.mjs'

export interface DevelopmentApplicationOptions {
  repositoryRoot?: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  spawn?: typeof spawnSync
  applyOverrides?: typeof applyDevelopmentPackageOverrides
}

export function startDevelopmentApplication(options?: DevelopmentApplicationOptions): Promise<number>
