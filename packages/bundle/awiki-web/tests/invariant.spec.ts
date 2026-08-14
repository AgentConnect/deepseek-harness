/** Empty bundle invariant registration and HMR-safe disposal. */

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as AwikiWebInvariant from '../src/invariant.ts'

describe('AWiki Web bundle invariant companion', () => {
  it('releases its package registration with its plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(AwikiWebInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-awiki-web', () => {})
    }).toThrow(/already registered/u)

    await fiber.dispose()
    await expect(ctx.plugin(AwikiWebInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
