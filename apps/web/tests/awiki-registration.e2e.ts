// Web e2e scenario: the optional AWiki Web bundle contributes its production
// Host service, TypeScript SDK provider, and built client bundle to the shipped
// Web composition. An empty SDK state file needs no external request, so the
// Loader, Host service, provider, Typert Remote, browser module loader, slot
// registration, and rendered drawer all run keylessly without a fake.
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const AWIKI_PATCH = join(REPO_ROOT, 'packages/bundle/awiki-web/cordis.patch.yml')
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/awiki-registration', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

/** Link one installed optional plugin into the profile resolution root. */
async function linkProfilePackage(home: string, name: string, target: string): Promise<void> {
  const link = join(home, 'profiles', 'node_modules', ...name.split('/'))
  await mkdir(dirname(link), { recursive: true })
  await symlink(target, link, 'junction')
}

describe('web e2e: AWiki registration drawer', () => {
  let harnessHome: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let consoleErrors: string[]

  beforeAll(async () => {
    harnessHome = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-awiki-home-')))
    await linkProfilePackage(
      harnessHome,
      '@deepseek-ai/dsh-awiki',
      join(REPO_ROOT, 'packages/awiki/awiki'),
    )
    await linkProfilePackage(
      harnessHome,
      '@deepseek-ai/dsh-client-ui-awiki',
      join(REPO_ROOT, 'packages/client/ui-awiki'),
    )
    const awikiEnvironment = {
      DSH_AWIKI_USER_SERVICE_URL: 'https://users.awiki.test',
      DSH_AWIKI_USER_SERVICE_DOMAIN: 'awiki.test',
      DSH_AWIKI_MESSAGE_SERVICE_URL: 'https://messages.awiki.test',
      DSH_AWIKI_MESSAGE_SERVICE_DID: 'did:wba:messages.awiki.test',
      DSH_AWIKI_MESSAGE_SERVICE_PUBLIC_URL: 'https://messages.awiki.test',
      DSH_AWIKI_ALLOWED_ATTACHMENT_ORIGINS: '["https://messages.awiki.test"]',
      DSH_AWIKI_STATE_PATH: join(harnessHome, 'awiki-web-e2e-state.json'),
      DSH_AWIKI_POLL_INTERVAL_MS: '5000',
      DSH_AWIKI_ATTACHMENT_MAX_BYTES: '10485760',
    }
    const originalEnvironment = Object.fromEntries(
      Object.keys(awikiEnvironment).map(key => [key, process.env[key]]),
    )
    Object.assign(process.env, awikiEnvironment)
    try {
      scaffold = await launchWebScaffold({ extraOverlayPath: AWIKI_PATCH, harnessHome })
    } finally {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error) {
      throw new AggregateError(
        [error, ...consoleErrors.map(message => new Error(message)), ...tripwire.pageErrors.map(message => new Error(message))],
        'AWiki Web composition did not render its frame',
      )
    }
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (harnessHome !== undefined) {
      await rm(harnessHome, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'AWiki Web e2e teardown failed')
  })

  it('opens the right-side entry into the shared-identity registration form', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-awiki-registration'))
    const trigger = page.getByRole('button', { name: '打开 AWiki' })
    await trigger.waitFor({ timeout: 15_000 })
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0)).toBeGreaterThan(1_600)

    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'AWiki' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('heading', { name: '注册 AWiki 身份' }).waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[role="dialog"][aria-labelledby]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('该身份由当前 Harness 部署中的全部 Agent 共同使用。')

    const requestOtp = dialog.getByRole('button', { name: '获取验证码' })
    expect(await requestOtp.isDisabled()).toBe(true)
    await dialog.getByRole('textbox', { name: 'Handle' }).fill('snapshot-agent')
    await dialog.getByRole('textbox', { name: '手机号' }).fill('13800000000')
    expect(await requestOtp.isEnabled()).toBe(true)
    expect(consoleErrors).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
