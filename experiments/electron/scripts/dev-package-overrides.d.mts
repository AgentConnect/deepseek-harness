export interface AppliedDevelopmentPackageOverride {
  archivePath: string
  archiveSha256: string
  direct: boolean
  name: string
  packagePath: string
  packageRoot: string
  version: string
}

export interface DevelopmentPackageOverrideArchive {
  archivePath: string
  name: string
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

export function resolveDevelopmentPackageOverrideArchives(options: {
  repositoryRoot: string
  configPath?: string
}): Promise<DevelopmentPackageOverrideArchive[]>

export function applyDevelopmentPackageOverrides(
  options: DevelopmentPackageOverrideOptions,
): Promise<AppliedDevelopmentPackageOverride[]>
