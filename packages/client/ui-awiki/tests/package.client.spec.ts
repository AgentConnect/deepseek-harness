/** Package halves and invariant assembly checks in the Client face. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as applyPackage } from '../src/index.ts'
import * as AwikiInvariant from '../src/invariant.ts'

describe('ui-awiki package halves', () => {
  it('keeps the Node package half intentionally empty', () => {
    applyPackage()
  })

  it('registers and withdraws the explained-empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry).await()
    expect(AwikiInvariant.name).toBe('client-ui-awiki-invariant')
    expect(AwikiInvariant.inject).toEqual(['invariants'])
    const fiber = await ctx.plugin(AwikiInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-client-ui-awiki', () => {})).toThrow(/already registered/u)
    await fiber.dispose()
    await expect(ctx.plugin(AwikiInvariant).await()).resolves.toBeDefined()
  })
})
