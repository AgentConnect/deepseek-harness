/** Environment variables accepted by the macOS distribution build. */
export interface MacDistributionEnvironment {
  APPLE_APP_SPECIFIC_PASSWORD?: string
  APPLE_ID?: string
  APPLE_TEAM_ID?: string
  DSH_MACOS_KEYCHAIN?: string
  DSH_MACOS_SIGN_IDENTITY?: string
  DSH_REQUIRE_MACOS_SIGNING?: string
}

/** Electron Packager options for a Developer ID distribution build. */
export interface MacDistributionOptions {
  osxNotarize?: {
    appleId: string
    appleIdPassword: string
    teamId: string
  }
  osxSign?: {
    continueOnError: false
    identity: string
    keychain?: string
    type: 'distribution'
  }
}

/** DMG maker options derived from the macOS distribution identity. */
export interface MacDmgOptions {
  additionalDMGOptions?: {
    'code-sign': {
      identifier: string
      'signing-identity': string
    }
  }
  format: 'UDZO'
  icon: string
}

const requiredNames = [
  'DSH_MACOS_SIGN_IDENTITY',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
] as const

/**
 * Resolve an all-or-nothing Developer ID signing and notarization configuration.
 * @param environment - Build environment without secret-value logging.
 * @returns Electron Packager signing options, or an empty object for an unsigned development build.
 */
export function resolveMacDistribution(environment: MacDistributionEnvironment): MacDistributionOptions {
  const requireSigning = environment.DSH_REQUIRE_MACOS_SIGNING
  if (requireSigning !== undefined && requireSigning !== '' && requireSigning !== '1') {
    throw new Error('DSH_REQUIRE_MACOS_SIGNING must be 1 or unset')
  }

  const values = requiredNames.map((name) => environment[name]?.trim() ?? '')
  const hasAnyCredential = values.some(Boolean)
  if (!hasAnyCredential && requireSigning !== '1') return {}

  const missingNames = requiredNames.filter((_, index) => values[index] === '')
  if (missingNames.length > 0) {
    throw new Error(`macOS distribution credentials are incomplete: missing ${missingNames.join(', ')}`)
  }

  const [identity, appleId, appleIdPassword, teamId] = values as [string, string, string, string]
  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error('DSH_MACOS_SIGN_IDENTITY must name a Developer ID Application identity')
  }

  const keychain = environment.DSH_MACOS_KEYCHAIN?.trim()
  return {
    osxSign: {
      identity,
      type: 'distribution',
      continueOnError: false,
      ...(keychain ? { keychain } : {}),
    },
    osxNotarize: {
      appleId,
      appleIdPassword,
      teamId,
    },
  }
}

/**
 * Resolve the mounted-volume icon and optional DMG signature.
 * @param distribution - Resolved app signing options.
 * @returns Electron Forge DMG maker configuration.
 */
export function resolveMacDmg(distribution: MacDistributionOptions): MacDmgOptions {
  return {
    format: 'UDZO',
    icon: 'assets/icon.icns',
    ...(distribution.osxSign
      ? {
          additionalDMGOptions: {
            'code-sign': {
              'signing-identity': distribution.osxSign.identity,
              identifier: 'com.agentconnect.deepseek-harness.dmg',
            },
          },
        }
      : {}),
  }
}
