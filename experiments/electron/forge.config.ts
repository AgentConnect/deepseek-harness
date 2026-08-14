import type { ForgeConfig } from '@electron-forge/shared-types'
import { resolveMacDistribution, resolveMacDmg } from './src/macos-distribution.ts'
import { pruneElectronLocales } from './src/package-prune.ts'

/**
 * Create the Electron Forge configuration for one build environment.
 * @param environment - Process environment containing optional macOS distribution credentials.
 * @returns A complete Forge configuration.
 */
export function createForgeConfig(environment: NodeJS.ProcessEnv): ForgeConfig {
  const macDistribution = resolveMacDistribution(environment)
  return {
    packagerConfig: {
      name: 'DeepSeek Harness',
      executableName: 'deepseek-harness',
      appBundleId: 'com.agentconnect.deepseek-harness',
      appCategoryType: 'public.app-category.developer-tools',
      icon: 'assets/icon',
      asar: true,
      prune: false,
      ...macDistribution,
      extraResource: ['.forge-runtime.tar.gz'],
      afterExtract: [(
        buildPath,
        _electronVersion,
        platform,
        _arch,
        callback,
      ) => {
        pruneElectronLocales(buildPath, platform).then(() => callback(), callback)
      }],
      ignore: [
        /[/\\](?:node_modules|src|tests|scripts|out)(?:[/\\]|$)/u,
        /[/\\]\.forge-runtime\.tar\.gz$/u,
      ],
    },
    makers: [
      {
        name: '@electron-forge/maker-dmg',
        platforms: ['darwin'],
        config: resolveMacDmg(macDistribution),
      },
      {
        name: '@electron-forge/maker-zip',
        platforms: ['darwin'],
        config: {},
      },
      {
        name: '@electron-forge/maker-squirrel',
        platforms: ['win32'],
        config: {
          name: 'DeepSeekHarness',
          setupExe: 'DeepSeek-Harness-Setup.exe',
          setupIcon: 'assets/icon.ico',
        },
      },
    ],
    outDir: 'out',
  }
}

export default createForgeConfig(process.env)
