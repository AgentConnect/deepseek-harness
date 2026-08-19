export interface RuntimeTarget {
  arch: 'arm64' | 'x64'
  localOverrides: boolean
  platform: 'darwin' | 'win32'
}

export function parseRuntimeTarget(args: string[]): RuntimeTarget
