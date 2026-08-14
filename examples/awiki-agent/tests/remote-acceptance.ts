#!/usr/bin/env node
/** Remote AWiki MVP runner used only by awiki-system-test. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AwikiMessage, AwikiResult } from '@deepseek-ai/dsh-awiki/types'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const NAME = 'awiki-remote-acceptance'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value === '') throw new Error(`${NAME}: ${name} is required`)
  return value
}

function requiredOption(name: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`${NAME}: --${name} is required`)
  return value
}

function resultValue<Value>(result: AwikiResult<Value>, operation: string): Value {
  if (!result.ok) throw new Error(`${NAME}: ${operation} failed with ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function runAgent(ctx: Context, agent: Agent, task: string): Promise<void> {
  await agent.whenIdle()
  const message = createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } })
  let acceptReceipt!: () => void
  const receipt = new Promise<void>((resolve) => { acceptReceipt = resolve })
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session || event.type !== 'agent/inbox/spliced'
      || !event.data.inserted.some(inserted => inserted.id === message.id)) return
    acceptReceipt()
  })
  try {
    agent.followup(message)
    await receipt
    await agent.whenIdle()
  } finally {
    dispose()
  }
}

function messageHasText(message: AwikiMessage, marker: string, senderDid: string): boolean {
  return message.senderDid === senderDid && message.content.kind === 'text' && message.content.text === marker
}

async function waitFor(
  read: () => Promise<readonly AwikiMessage[]>,
  matches: (message: AwikiMessage) => boolean,
): Promise<AwikiMessage> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const found = (await read()).find(matches)
    if (found !== undefined) return found
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`${NAME}: timed out waiting for the peer observation`)
}

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    report: { type: 'string' },
    cleanup: { type: 'string' },
    attachment: { type: 'string' },
    prepare: { type: 'boolean', default: false },
  },
  strict: true,
})
const configPath = requiredOption('config', values.config)
const reportPath = requiredOption('report', values.report)
const cleanupPath = requiredOption('cleanup', values.cleanup)
const attachmentPath = values.attachment
if (!values.prepare && attachmentPath === undefined) {
  throw new Error(`${NAME}: --attachment is required outside preparation`)
}
const peerConfigPath = fileURLToPath(new URL('../remote-peer.cordis.yml', import.meta.url))

async function main(): Promise<void> {
  const uninstallFailLoud = installFailLoud(NAME)
  let ctx: Context | undefined
  let peer: Context | undefined
  try {
    loadEnv(NAME)
    ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
    if (values.prepare) {
      const existing = resultValue(await ctx.awiki.getIdentity(), 'read unregistered identity')
      if (existing !== null) throw new Error(`${NAME}: preparation requires an empty primary state`)
      const otp = resultValue(await ctx.awiki.sendRegistrationOtp({
        handle: required('DSH_AWIKI_PRIMARY_HANDLE'),
        phone: required('DSH_AWIKI_PRIMARY_PHONE'),
      }), 'send registration OTP')
      if (typeof otp.retryAt !== 'string' || typeof otp.retryAfterSeconds !== 'number') {
        throw new Error(`${NAME}: registration OTP result is incomplete`)
      }
      const registered = resultValue(await ctx.awiki.registerIdentity({
        handle: required('DSH_AWIKI_PRIMARY_HANDLE'),
        phone: required('DSH_AWIKI_PRIMARY_PHONE'),
        otp: required('DSH_AWIKI_PRIMARY_OTP'),
      }), 'register identity')
      await writeFile(cleanupPath, `${JSON.stringify({ did: registered.did })}\n`, { encoding: 'utf8', mode: 0o600 })
      await writeFile(reportPath, `${JSON.stringify({
        schema_version: 1,
        scenario: 'deepseek-harness-awiki-mvp-preparation',
        did: registered.did,
      }, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      return
    }

    if (attachmentPath === undefined) throw new Error(`${NAME}: attachment path is unavailable`)
    const registered = resultValue(await ctx.awiki.getIdentity(), 'read prepared identity')
    if (registered === null) throw new Error(`${NAME}: acceptance requires a prepared primary identity`)
    await writeFile(cleanupPath, `${JSON.stringify({ did: registered.did })}\n`, { encoding: 'utf8', mode: 0o600 })

    const directMarker = `dsh-direct-${randomUUID()}`
    const groupMarker = `dsh-group-${randomUUID()}`
    const attachmentMarker = `dsh-attachment-${randomUUID()}`
    process.env.DSH_AWIKI_DIRECT_MARKER = directMarker
    process.env.DSH_AWIKI_GROUP_MARKER = groupMarker
    process.env.DSH_AWIKI_ATTACHMENT_MARKER = attachmentMarker
    process.env.DSH_AWIKI_DIRECT_IDEMPOTENCY_KEY = randomUUID()
    process.env.DSH_AWIKI_GROUP_IDEMPOTENCY_KEY = randomUUID()
    process.env.DSH_AWIKI_ATTACHMENT_IDEMPOTENCY_KEY = randomUUID()
    process.env.DSH_AWIKI_ATTACHMENT_BASE64 = (await readFile(attachmentPath)).toString('base64')

    const agents = [...ctx.agents.roots()].sort((left, right) => String(left.session.id).localeCompare(String(right.session.id)))
    const [agentA, agentB] = agents
    if (agentA === undefined || agentB === undefined || agents.length !== 2) {
      throw new Error(`${NAME}: expected exactly two configured agents`)
    }
    await Promise.all([
      runAgent(ctx, agentA, 'Run the remote AWiki scenario as agent A.'),
      runAgent(ctx, agentB, 'Run the remote AWiki scenario as agent B.'),
    ])
    const identityAfterAgentRuns = resultValue(await ctx.awiki.getIdentity(), 'restore identity')
    if (identityAfterAgentRuns?.did !== registered.did) throw new Error(`${NAME}: Harness agents did not retain one DID`)

    peer = await boot(`${NAME}-peer`, peerConfigPath)
    const directConversation = resultValue(await peer.awiki.listConversations(), 'list peer conversations').items.find(
      conversation => conversation.kind === 'direct' && conversation.peerDid === registered.did,
    )
    if (directConversation === undefined) throw new Error(`${NAME}: peer cannot see the Harness Direct conversation`)
    const groupTarget = required('DSH_AWIKI_GROUP_TARGET')
    const groupConversation = resultValue(await peer.awiki.listConversations(), 'list peer group conversations').items.find(
      conversation => conversation.kind === 'group'
        && (conversation.id === groupTarget || conversation.groupDid === groupTarget),
    )
    if (groupConversation === undefined) throw new Error(`${NAME}: peer cannot see the configured group`)

    const directRead = async (): Promise<readonly AwikiMessage[]> => resultValue(
      await peer!.awiki.getHistory({ conversationId: directConversation.id }),
      'read peer Direct history',
    ).items
    const groupRead = async (): Promise<readonly AwikiMessage[]> => resultValue(
      await peer!.awiki.getHistory({ conversationId: groupConversation.id }),
      'read peer group history',
    ).items
    await waitFor(directRead, message => messageHasText(message, directMarker, registered.did))
    await waitFor(groupRead, message => messageHasText(message, groupMarker, registered.did))
    const attachmentMessage = await waitFor(
      directRead,
      message => message.senderDid === registered.did
        && message.content.kind === 'attachment'
        && message.content.caption === attachmentMarker,
    )
    if (attachmentMessage.content.kind !== 'attachment') throw new Error(`${NAME}: attachment message changed type`)
    const download = resultValue(await peer.awiki.downloadAttachment({
      attachmentId: attachmentMessage.content.attachment.id,
      messageId: attachmentMessage.id,
    }), 'download peer attachment')
    const expectedSha256 = required('DSH_AWIKI_EXPECTED_ATTACHMENT_SHA256')
    const actualSha256 = createHash('sha256').update(Buffer.from(download.bytesBase64, 'base64')).digest('hex')
    if (download.attachment.sha256 !== expectedSha256 || actualSha256 !== expectedSha256) {
      throw new Error(`${NAME}: downloaded attachment SHA-256 differs from the source`)
    }

    await ctx.fiber.dispose()
    ctx = await boot(`${NAME}-restart`, resolveConfigPath(configPath, undefined))
    const restored = resultValue(await ctx.awiki.getIdentity(), 'read identity after restart')
    const report = {
      schema_version: 1,
      scenario: 'deepseek-harness-awiki-mvp',
      status: 'passed',
      case_ids: [
        'DSH-AWIKI-MVP-001',
        'DSH-AWIKI-MVP-002',
        'DSH-AWIKI-MVP-003',
        'DSH-AWIKI-MVP-004',
        'DSH-AWIKI-MVP-005',
      ],
      checks: {
        registration_persisted: restored?.did === registered.did,
        shared_sender_did: identityAfterAgentRuns?.did === registered.did,
        direct_observed: true,
        existing_group_observed: true,
        attachment_sha256_verified: true,
      },
    }
    if (!Object.values(report.checks).every(Boolean)) throw new Error(`${NAME}: one acceptance check failed`)
    await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } finally {
    await peer?.fiber.dispose()
    await ctx?.fiber.dispose()
    uninstallFailLoud()
  }
}

await main()
