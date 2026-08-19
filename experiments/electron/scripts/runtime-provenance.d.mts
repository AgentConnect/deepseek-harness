export interface RuntimeLocalOverrideProvenance {
  archiveSha256: string
  installedPackageSha256: string
  name: string
  version: string
}

export interface RuntimeProvenance {
  schemaVersion: 1
  target: {
    arch: string
    platform: string
  }
  localOverrides: RuntimeLocalOverrideProvenance[]
}

export const RUNTIME_PROVENANCE_FILE: '.dsh-runtime-provenance.json'

export function digestDirectory(root: string): Promise<string>
export function digestFile(path: string): Promise<string>
export function writeRuntimeProvenance(options: {
  root: string
  platform: 'darwin' | 'win32'
  arch: 'arm64' | 'x64'
  localOverrides: RuntimeLocalOverrideProvenance[]
}): Promise<RuntimeProvenance>
export function readRuntimeProvenance(root: string): Promise<RuntimeProvenance>
