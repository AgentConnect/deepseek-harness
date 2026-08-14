import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const expectedPath = fileURLToPath(new URL('./snapshots/awiki-mvp.expected.json', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface EmittedEvent {
  readonly type: 'session_event'
  readonly agent: string
  readonly event: SessionEvent
}

function toolResultText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return event.data.message.content.flatMap((block) => {
    if (block.type !== 'tool-result') return []
    return block.content.flatMap(item => item.type === 'text' ? [item.text] : [])
  }).join('\n')
}

function agentLabel(sessionId: string): string {
  if (sessionId.startsWith('awiki-agent-a-session-')) return 'agent-a'
  if (sessionId.startsWith('awiki-agent-b-session-')) return 'agent-b'
  throw new Error(`unexpected AWiki snapshot session id ${JSON.stringify(sessionId)}`)
}

function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function project(record: EmittedEvent): Record<string, unknown> | undefined {
  const { event } = record
  const agent = agentLabel(record.agent)
  switch (event.type) {
    case 'tool/call':
      return { agent, type: event.type, name: event.data.name, arguments: JSON.parse(event.data.arguments) }
    case 'tool/result':
      return { agent, type: event.type, text: toolResultText(event) }
    case 'approval/asked':
      return { agent, type: event.type, toolName: event.data.toolName, reason: event.data.reason }
    case 'approval/decided':
      return { agent, type: event.type, outcome: event.data.outcome }
    case 'assistant/message': {
      const text = assistantText(event)
      return text === '' ? undefined : { agent, type: event.type, text }
    }
    default:
      return undefined
  }
}

describe('AWiki MVP assembled snapshot', () => {
  it('shares one identity while reading and sending direct, group, and attachment messages', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'AWiki MVP keyless snapshot',
      tempDirPrefix: 'awiki-agent-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      inspect: async (cwd) => {
        expect(await readFile(join(cwd, '.awiki-fake-disposed'), 'utf8')).toBe('disposed\n')
      },
    })
    expect(stderr).toBe('')
    const records = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const rawResult = records.at(-1)
    const result = rawResult === undefined ? undefined : {
      ...rawResult,
      agents: Array.isArray(rawResult['agents'])
        ? rawResult['agents'].map((agent) => {
          const value = agent as Record<string, unknown>
          return { ...value, id: agentLabel(String(value['id'])) }
        })
        : rawResult['agents'],
    }
    const transcript = records.slice(0, -1).flatMap((record) => {
      if (record['type'] !== 'session_event') return []
      const projected = project(record as unknown as EmittedEvent)
      return projected === undefined ? [] : [projected]
    })
    const actual = { transcript, result }
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      await writeFile(expectedPath, `${JSON.stringify(actual, undefined, 2)}\n`, 'utf8')
    }
    const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as unknown
    expect(actual).toEqual(expected)

    const visible = JSON.stringify(actual)
    expect(visible).toContain('did:awiki:snapshot:shared')
    expect(visible).toContain('conversation-direct')
    expect(visible).toContain('conversation-group')
    expect(visible).toContain('sha256')
    for (const secretMarker of ['private_key', 'access_token', 'upload_ticket', 'download_token']) {
      expect(visible).not.toContain(secretMarker)
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
