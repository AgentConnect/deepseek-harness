/** Deterministic model adapter for the assembled AWiki tool snapshot. */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

interface ScriptedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

const AGENT_A_CALLS: readonly ScriptedCall[] = [
  { name: 'awiki_identity_status', arguments: {} },
  { name: 'awiki_list_conversations', arguments: {} },
  { name: 'awiki_history', arguments: { conversation_id: 'conversation-direct' } },
  {
    name: 'awiki_send_message',
    arguments: {
      target_kind: 'direct',
      target: 'peer@awiki.info',
      text: 'hello from Harness agent A',
      idempotency_key: 'snapshot-agent-a-text',
    },
  },
  {
    name: 'awiki_send_attachment',
    arguments: {
      target_kind: 'group',
      target: 'did:awiki:group:snapshot',
      file_name: 'snapshot.txt',
      mime_type: 'text/plain',
      bytes_base64: 'QVdpa2kgc25hcHNob3QgYXR0YWNobWVudC4K',
      caption: 'Harness snapshot attachment',
      idempotency_key: 'snapshot-agent-a-attachment',
    },
  },
]

const AGENT_B_CALLS: readonly ScriptedCall[] = [
  { name: 'awiki_identity_status', arguments: {} },
  {
    name: 'awiki_send_message',
    arguments: {
      target_kind: 'group',
      target: 'did:awiki:group:snapshot',
      text: 'hello from Harness agent B',
      idempotency_key: 'snapshot-agent-b-text',
    },
  },
]

function text(message: Message): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function script(messages: readonly Message[]): readonly ScriptedCall[] {
  const task = messages.filter(message => message.role === 'user').map(text).join('\n')
  return task.includes('agent B') ? AGENT_B_CALLS : AGENT_A_CALLS
}

function resultCount(messages: readonly Message[]): number {
  return messages.reduce(
    (count, message) => count + message.content.filter(block => block.type === 'tool-result').length,
    0,
  )
}

/** Keyless adapter that walks each agent through its fixed AWiki tool sequence. */
class AwikiKeylessAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const calls = script(options.messages)
    const index = resultCount(options.messages)
    const call = calls[index]
    if (call !== undefined) {
      const argumentsJson = JSON.stringify(call.arguments)
      const callId = CallId(`awiki-snapshot-${index}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: call.name, argumentsDelta: argumentsJson }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: callId, name: call.name, arguments: argumentsJson },
      }
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const reply = calls === AGENT_B_CALLS ? 'AGENT_B_AWIKI_COMPLETE' : 'AGENT_A_AWIKI_COMPLETE'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'awiki-keyless-llm'
export const inject = ['llm']

/** Register the deterministic AWiki snapshot adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['awiki-keyless'], new AwikiKeylessAdapter())
}
