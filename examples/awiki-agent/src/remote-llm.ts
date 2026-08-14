/** Deterministic model adapter for the opt-in remote AWiki acceptance. */

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

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value === '') throw new Error(`awiki remote adapter: ${name} is required`)
  return value
}

function text(message: Message): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function resultCount(messages: readonly Message[]): number {
  return messages.reduce(
    (count, message) => count + message.content.filter(block => block.type === 'tool-result').length,
    0,
  )
}

function callsFor(messages: readonly Message[]): readonly ScriptedCall[] {
  const task = messages.filter(message => message.role === 'user').map(text).join('\n')
  if (task.includes('agent B')) {
    return [
      { name: 'awiki_identity_status', arguments: {} },
      {
        name: 'awiki_send_message',
        arguments: {
          target_kind: 'group',
          target: required('DSH_AWIKI_GROUP_TARGET'),
          text: required('DSH_AWIKI_GROUP_MARKER'),
          idempotency_key: required('DSH_AWIKI_GROUP_IDEMPOTENCY_KEY'),
        },
      },
    ]
  }
  return [
    { name: 'awiki_identity_status', arguments: {} },
    {
      name: 'awiki_send_message',
      arguments: {
        target_kind: 'direct',
        target: required('DSH_AWIKI_PEER_TARGET'),
        text: required('DSH_AWIKI_DIRECT_MARKER'),
        idempotency_key: required('DSH_AWIKI_DIRECT_IDEMPOTENCY_KEY'),
      },
    },
    {
      name: 'awiki_send_attachment',
      arguments: {
        target_kind: 'direct',
        target: required('DSH_AWIKI_PEER_TARGET'),
        file_name: 'awiki-harness-mvp-attachment.txt',
        mime_type: 'text/plain',
        bytes_base64: required('DSH_AWIKI_ATTACHMENT_BASE64'),
        caption: required('DSH_AWIKI_ATTACHMENT_MARKER'),
        idempotency_key: required('DSH_AWIKI_ATTACHMENT_IDEMPOTENCY_KEY'),
      },
    },
  ]
}

/** Remote adapter that makes two real agents send the acceptance messages. */
class AwikiRemoteAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const calls = callsFor(options.messages)
    const index = resultCount(options.messages)
    const call = calls[index]
    if (call !== undefined) {
      const argumentsJson = JSON.stringify(call.arguments)
      const callId = CallId(`awiki-remote-${index}`)
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

    const reply = 'AWIKI_REMOTE_AGENT_COMPLETE'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'awiki-remote-llm'
export const inject = ['llm']

/** Register the deterministic adapter used only by the remote runner. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['awiki-remote'], new AwikiRemoteAdapter())
}
