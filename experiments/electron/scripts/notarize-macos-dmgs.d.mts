export interface NotarizeMacDmgsOptions {
  root: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: (file: string, args: string[]) => Promise<unknown>
  inspectMount?: (mountPoint: string) => Promise<void>
}

export function findDmgs(root: string): Promise<string[]>
export function validateMountedDmg(mountPoint: string): Promise<void>
export function notarizeMacDmgs(options: NotarizeMacDmgsOptions): Promise<string[]>
