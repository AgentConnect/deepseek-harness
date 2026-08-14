/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-awiki-web`.
 * @module @deepseek-ai/dsh-awiki-web/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-awiki-web'

/** Cordis companion plugin name. */
export const name = 'awiki-web-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package carries a static list of Loader rows and
// owns no service, events, or mutable data. Each inserted plugin owns the
// runtime relationships it contributes.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
