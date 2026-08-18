export interface AppliedDevelopmentPackageOverride {
  archivePath: string
  name: string
  packageRoot: string
}

export interface DevelopmentPackageOverrideOptions {
  repositoryRoot: string
  configPath?: string
  cliManifestPath?: string
  cliNodeModules?: string
  storageRoot?: string
  resolveInstalledPackage?: (input: {
    repositoryRoot: string
    cliPackageName: string
    packageName: string
  }) => string
  installDependencies?: (input: {
    dependencies: Record<string, string>
    repositoryRoot: string
    storageRoot: string
  }) => Promise<string>
}

export const DEVELOPMENT_PACKAGE_OVERRIDE_CONFIG: '.dev-package-overrides.json'

export function applyDevelopmentPackageOverrides(
  options: DevelopmentPackageOverrideOptions,
): Promise<AppliedDevelopmentPackageOverride[]>
