/** Test-only approval answerer for the AWiki send-tool snapshot. */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'awiki-keyless-approval'
export const inject = ['approval']

/** Grant each send operation once so the snapshot exercises the approved path. */
export function apply(ctx: Context): void {
  ctx.on('approval/request', () => Promise.resolve('allowed-once'))
}
