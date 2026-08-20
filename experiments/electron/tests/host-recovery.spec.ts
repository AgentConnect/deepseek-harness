import { describe, expect, it } from 'vitest'
import { BoundedHostRestartPolicy, hostRecoveryPageUrl } from '../src/host-recovery.ts'

describe('Electron Host recovery', () => {
  it('bounds automatic retries inside a rolling window and restores the budget later', () => {
    const policy = new BoundedHostRestartPolicy([250, 1_000], 60_000)
    expect(policy.nextDelay(1_000)).toBe(250)
    expect(policy.nextDelay(1_100)).toBe(1_000)
    expect(policy.nextDelay(1_200)).toBeNull()
    expect(policy.nextDelay(61_100)).toBe(250)
  })

  it('builds a script-free recovery document for both states', () => {
    const restarting = decodeURIComponent(hostRecoveryPageUrl('restarting'))
    const stopped = decodeURIComponent(hostRecoveryPageUrl('stopped'))
    expect(restarting).toContain('正在恢复本地服务')
    expect(stopped).toContain('本地服务已停止')
    expect(restarting).not.toContain('<script')
    expect(stopped).not.toContain('<script')
  })
})
