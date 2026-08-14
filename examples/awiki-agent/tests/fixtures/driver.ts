#!/usr/bin/env node
/** Real-Loader driver for two deterministic AWiki agent turns. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const NAME = 'awiki-keyless-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string | undefined {
  const blocks = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  return blocks.length === 0 ? undefined : blocks.join('')
}

async function runAgent(ctx: Context, agent: Agent, task: string): Promise<{ output: string; usage?: TokenUsage }> {
  await agent.whenIdle()
  const message = createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } })
  let acceptReceipt!: () => void
  const receipt = new Promise<void>((resolve) => { acceptReceipt = resolve })
  let received = false
  let output = ''
  const usageByStep = new Map<string, TokenUsage>()
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (!received) {
      if (event.type !== 'agent/inbox/spliced'
        || !event.data.inserted.some(inserted => inserted.id === message.id)) return
      received = true
      acceptReceipt()
    }
    process.stdout.write(`${JSON.stringify({ type: 'session_event', agent: agent.session.id, event })}\n`)
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      usageByStep.set(`${event.data.turn}/${event.data.step}`, event.data.chunk.usage)
    }
    if (event.type === 'assistant/message') output = assistantText(event) ?? output
  })
  try {
    agent.followup(message)
    await receipt
    await agent.whenIdle()
  } finally {
    dispose()
  }
  await ctx.sessions.flush(agent.session)
  const usage = [...usageByStep.values()].reduce<TokenUsage>((total, item) => ({
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
  }), { inputTokens: 0, outputTokens: 0 })
  return { output, usage }
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const agents = [...ctx.agents.roots()].sort((left, right) => String(left.session.id).localeCompare(String(right.session.id)))
  if (agents.length !== 2) throw new Error(`${NAME}: expected two top-level agents, found ${agents.length}`)
  const [agentA, agentB] = agents
  if (agentA === undefined || agentB === undefined) throw new Error(`${NAME}: configured agents are unavailable`)
  const first = await runAgent(ctx, agentA, 'Run the AWiki MVP scenario as agent A.')
  const second = await runAgent(ctx, agentB, 'Run the AWiki MVP scenario as agent B.')
  process.stdout.write(`${JSON.stringify({ type: 'result', agents: [
    { id: agentA.session.id, ...first },
    { id: agentB.session.id, ...second },
  ] })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
