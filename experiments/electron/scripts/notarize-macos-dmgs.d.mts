export interface NotarizeMacDmgsOptions {
  root: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: (file: string, args: string[]) => Promise<unknown>
}

export function findDmgs(root: string): Promise<string[]>
export function notarizeMacDmgs(options: NotarizeMacDmgsOptions): Promise<string[]>
