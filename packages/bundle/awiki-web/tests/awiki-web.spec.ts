/** The AWiki Web bundle manifest, patch rows, ordering, and environment mapping. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

interface Expression {
  __jsExpr: string
}

interface Row {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

const root = fileURLToPath(new URL('..', import.meta.url))

function load(): { manifest: Record<string, unknown>; rows: Row[] } {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (patch === undefined) throw new Error('AWiki Web bundle must declare its patch')
  const parsed = yaml.load(readFileSync(resolve(root, patch), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('AWiki Web patch must be a list')
  const rows = parsed.flatMap((entry): Row[] =>
    typeof entry === 'object' && entry !== null
      ? (entry as { insert?: Row[] }).insert ?? []
      : [],
  )
  return { manifest, rows }
}

function expression(config: Record<string, unknown>, key: string): string {
  const value = config[key] as Expression | undefined
  if (value?.__jsExpr === undefined) throw new Error(`${key} must be a !!js expression`)
  return value.__jsExpr
}

describe('dsh-awiki-web bundle', () => {
  it('declares only the AWiki Host, SDK provider, and browser plugin in dependency order', () => {
    const { manifest, rows } = load()
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['awiki', '@deepseek-ai/dsh-awiki'],
      ['awiki-provider', '@deepseek-ai/dsh-awiki/provider'],
      ['ui-awiki', '@deepseek-ai/dsh-client-ui-awiki'],
    ])
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-awiki': 'workspace:^',
      '@deepseek-ai/dsh-client-ui-awiki': 'workspace:^',
    })
  })

  it('maps deployment values from the named environment variables with bounded defaults', () => {
    const { rows } = load()
    const config = rows[0]?.config
    if (config === undefined) throw new Error('AWiki Host row must have config')
    expect(expression(config, 'userServiceUrl')).toBe('process.env.DSH_AWIKI_USER_SERVICE_URL')
    expect(expression(config, 'userServiceDomain')).toBe('process.env.DSH_AWIKI_USER_SERVICE_DOMAIN')
    expect(expression(config, 'messageServiceUrl')).toBe('process.env.DSH_AWIKI_MESSAGE_SERVICE_URL')
    expect(expression(config, 'messageServiceDid')).toBe('process.env.DSH_AWIKI_MESSAGE_SERVICE_DID')
    expect(expression(config, 'messageServicePublicUrl')).toBe('process.env.DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL')
    expect(expression(config, 'allowedAttachmentOrigins')).toBe("JSON.parse(process.env.DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS ?? '[]')")
    expect(expression(config, 'statePath')).toBe('process.env.DSH_AWIKI_STATE_PATH')
    expect(expression(config, 'pollIntervalMs')).toBe("Number(process.env.DSH_AWIKI_POLL_INTERVAL_MS ?? '5000')")
    expect(expression(config, 'attachmentMaxBytes')).toBe("Number(process.env.DSH_AWIKI_ATTACHMENT_MAX_BYTES ?? '10485760')")
    expect(rows[1]?.config).toBeUndefined()
    expect(rows[2]?.config).toBeUndefined()
    expect(config).not.toHaveProperty('allowInsecureLoopbackForTesting')
  })

  it('preserves explicit zero and invalid numeric values for Host validation', () => {
    const { rows } = load()
    const config = rows[0]?.config
    if (config === undefined) throw new Error('AWiki Host row must have config')
    const poll = expression(config, 'pollIntervalMs')
    const attachment = expression(config, 'attachmentMaxBytes')
    expect(evaluate({ process: { env: {} } }, poll)).toBe(5_000)
    expect(evaluate({ process: { env: {} } }, attachment)).toBe(10_485_760)
    expect(evaluate({ process: { env: { DSH_AWIKI_POLL_INTERVAL_MS: '0' } } }, poll)).toBe(0)
    expect(evaluate({ process: { env: { DSH_AWIKI_ATTACHMENT_MAX_BYTES: 'bad' } } }, attachment)).toBeNaN()
  })

  it('passes an empty or explicit attachment-origin list to Host validation', () => {
    const { rows } = load()
    const config = rows[0]?.config
    if (config === undefined) throw new Error('AWiki Host row must have config')
    const origins = expression(config, 'allowedAttachmentOrigins')
    expect(evaluate({ process: { env: {} }, JSON }, origins)).toEqual([])
    expect(evaluate({
      process: { env: { DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS: '["https://objects.awiki.example"]' } },
      JSON,
    }, origins)).toEqual(['https://objects.awiki.example'])
    expect(() => {
      evaluate({
        process: { env: { DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS: 'not-json' } },
        JSON,
      }, origins)
    }).toThrow()
  })
})
