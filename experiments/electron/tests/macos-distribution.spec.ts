import { describe, expect, it } from 'vitest'
import { resolveMacDistribution, resolveMacDmg } from '../src/macos-distribution.ts'

const completeEnvironment = {
  DSH_MACOS_SIGN_IDENTITY: 'Developer ID Application: AgentConnect (TEAM123456)',
  APPLE_ID: 'release@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password',
  APPLE_TEAM_ID: 'TEAM123456',
}

describe('macOS distribution configuration', () => {
  it('keeps local development builds unsigned when no credentials are configured', () => {
    expect(resolveMacDistribution({})).toEqual({})
  })

  it('requires every signing and notarization credential together', () => {
    expect(() => resolveMacDistribution({
      DSH_MACOS_SIGN_IDENTITY: completeEnvironment.DSH_MACOS_SIGN_IDENTITY,
    })).toThrowError(
      'macOS distribution credentials are incomplete: missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID',
    )
  })

  it('rejects development identities for distributable installers', () => {
    expect(() => resolveMacDistribution({
      ...completeEnvironment,
      DSH_MACOS_SIGN_IDENTITY: 'Apple Development: release@example.com (TEAM123456)',
    })).toThrowError('DSH_MACOS_SIGN_IDENTITY must name a Developer ID Application identity')
  })

  it('fails a required release build instead of silently producing an unsigned app', () => {
    expect(() => resolveMacDistribution({ DSH_REQUIRE_MACOS_SIGNING: '1' })).toThrowError(
      'macOS distribution credentials are incomplete',
    )
  })

  it('configures strict distribution signing and Apple notarization', () => {
    expect(resolveMacDistribution({
      ...completeEnvironment,
      DSH_MACOS_KEYCHAIN: '/tmp/release.keychain-db',
    })).toEqual({
      osxSign: {
        identity: completeEnvironment.DSH_MACOS_SIGN_IDENTITY,
        type: 'distribution',
        continueOnError: false,
        keychain: '/tmp/release.keychain-db',
      },
      osxNotarize: {
        appleId: completeEnvironment.APPLE_ID,
        appleIdPassword: completeEnvironment.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: completeEnvironment.APPLE_TEAM_ID,
      },
    })
  })

  it('uses the product icon for the mounted DMG volume', () => {
    expect(resolveMacDmg(resolveMacDistribution({}))).toMatchObject({
      format: 'UDZO',
      icon: 'assets/icon.icns',
    })
  })

  it('signs the DMG with the same Developer ID identity as the app', () => {
    expect(resolveMacDmg(resolveMacDistribution(completeEnvironment))).toMatchObject({
      additionalDMGOptions: {
        'code-sign': {
          'signing-identity': completeEnvironment.DSH_MACOS_SIGN_IDENTITY,
          identifier: 'com.agentconnect.deepseek-harness.dmg',
        },
      },
    })
  })
})
