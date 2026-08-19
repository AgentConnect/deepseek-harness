import type { AppliedDevelopmentPackageOverride } from './dev-package-overrides.mjs'

export function applyStagedPackageOverrides(options: {
  repositoryRoot: string
  runtimeRoot: string
}): Promise<AppliedDevelopmentPackageOverride[]>
