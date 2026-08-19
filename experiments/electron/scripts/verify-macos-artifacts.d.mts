export interface VerifiedMacosArtifacts {
  app: string
  dmg?: string
  zip?: string
  nativeFileCount: number
  localOverrides: Array<{
    name: string
    version: string
  }>
}

export function verifyMachOArchitecture(
  path: string,
  arch: 'arm64' | 'x64',
  run?: (file: string, args: string[]) => Promise<{ stdout: string }>,
): Promise<string[]>

export function verifyMacosArtifacts(options: {
  arch: 'arm64' | 'x64'
  localOverrides: boolean
  packageOnly: boolean
}): Promise<VerifiedMacosArtifacts>
