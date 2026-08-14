import type { ForgeConfig } from '@electron-forge/shared-types'
import { pruneElectronLocales } from './src/package-prune.ts'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'DeepSeek Harness',
    executableName: 'deepseek-harness',
    appBundleId: 'com.agentconnect.deepseek-harness',
    appCategoryType: 'public.app-category.developer-tools',
    icon: 'assets/icon',
    asar: true,
    prune: false,
    extraResource: ['.forge-runtime'],
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
      /[/\\]\.forge-runtime(?:[/\\]|$)/u,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: { format: 'UDZO' },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
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

export default config
