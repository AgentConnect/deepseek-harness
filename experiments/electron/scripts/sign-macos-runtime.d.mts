export interface SignMacRuntimeOptions {
  root: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: (file: string, args: string[]) => Promise<unknown>
}

export declare function isMachOBinary(path: string): Promise<boolean>

export declare function findMachOBinaries(directory: string): Promise<string[]>

export declare function signMacRuntime(options: SignMacRuntimeOptions): Promise<string[]>
