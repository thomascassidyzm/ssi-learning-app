#!/usr/bin/env node
// The first-step feasibility probe. Do not extend until a real belt transition
// has been observed from the blank fixture; never accelerate or skip playback.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { FIXTURES, FIXTURE_COURSE } from './fixtures/test-accounts.mjs'
import { CHROME_PATH, SB_URL, ANON_KEY, svc, sessionKey, instrument, NET, waitAudible } from './journeys/lib.mjs'
import { firstBeltVerdict } from './release-evidence.mjs'

const base = process.env.BASE_URL || 'https://staging.saysomethingin.app'
if (new URL(base).hostname !== 'staging.saysomethingin.app') throw new Error('This fixture-mutating probe is restricted to staging')
if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH is required')
const out = join(process.env.CS_SCRATCH, 'tmp', 'release-pass', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(out, { recursive: true, mode: 0o700 })
const result = { step: 'first-belt-change', run: 'web', verdict: 'not checked', base, evidence: {}, notes: [] }
let browser
let interrupted = false
process.on('SIGINT', () => { interrupted = true })
process.on('SIGTERM', () => { interrupted = true })
try {
  const secrets = Object.fromEntries(readFileSync(join(homedir(), '.secrets/ssi-test-accounts.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  if (!secrets.COLOMBO_FRESH_PASSWORD) throw new Error('Missing fresh fixture password')
  const auth = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FIXTURES.fresh.email, password: secrets.COLOMBO_FRESH_PASSWORD }),
    signal: AbortSignal.timeout(20000),
  })
  if (!auth.ok) throw new Error(`Fixture password sign-in HTTP ${auth.status}`)
  const session = await auth.json()
  const service = svc()
  const { data: learner, error } = await service.from('learners').select('id,is_internal').eq('user_id', session.user.id).single()
  if (error || learner?.is_internal !== true) throw new Error('Cannot verify fresh fixture as internal')
  // Same scoped enrolment reset as tools/test-accounts/seed.mjs; no account,
  // password or entitlement changes, and never a real learner selected by default.
  const reset = await service.from('course_enrollments').delete().eq('learner_id', learner.id).eq('course_id', FIXTURE_COURSE)
  if (reset.error) throw new Error('Fresh fixture enrolment reset failed')
  result.evidence.fixtureReset = true
  const version = await fetch(`${base}/version.json`, { signal: AbortSignal.timeout(15000), cache: 'no-store' }).then(r => r.json())
  result.evidence.deployment = version
  const shell = CHROME_PATH.replace('/chromium-', '/chromium_headless_shell-')
    .replace('/chrome-linux64/chrome', '/chrome-headless-shell-linux64/chrome-headless-shell')
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (existsSync(shell) ? shell : CHROME_PATH), args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await context.addInitScript(instrument)
  await context.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [sessionKey, session])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const runtimeBuilds = new Set()
  page.on('request', req => {
    if (!req.url().includes('/api/player-events')) return
    try {
      for (const event of req.postDataJSON()?.events || []) {
        if (event.client_version) runtimeBuilds.add(event.client_version)
      }
    } catch { /* absent telemetry is not proof of build identity */ }
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET.good })
  await page.goto(`${base}/?course=${FIXTURE_COURSE}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.locator('.belt-badge').waitFor({ timeout: 30000 })
  result.evidence.before = await page.locator('body').innerText()
  await page.screenshot({ path: join(out, 'before.png') })
  if (!/White Belt/i.test(result.evidence.before)) throw new Error('Blank fixture did not show White Belt')
  const fast = page.getByText('Fast', { exact: true })
  if (await fast.isVisible()) await fast.click()
  await page.evaluate(() => { window.__startPaint = window.__navProbe() })
  let clicked = false
  for (const selector of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")', '[aria-label*="play" i]']) {
    const control = page.locator(selector).first()
    if (await control.isVisible() && await control.isEnabled()) {
      await control.click(); clicked = true; break
    }
  }
  if (!clicked) throw new Error('No usable start control')
  result.evidence.startPaint = await page.evaluate(() => window.__startPaint)
  const audible = await waitAudible(page, Date.now() + 45000)
  result.evidence.audio = audible
  if (!audible) throw new Error('No lesson media-clock advancement observed within 45 seconds')
  const deadline = Date.now() + Number(process.env.BELT_TIMEOUT_MS || 3600000)
  while (!interrupted && Date.now() < deadline) {
    const body = await page.locator('body').innerText()
    result.evidence.lastScreen = body
    result.evidence.pageErrors = errors
    writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2))
    if (errors.length) throw new Error('Uncaught page error during playback')
    const yellow = page.locator('.player.belt-yellow')
    if (await yellow.isVisible()) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
      await page.screenshot({ path: join(out, 'transition.png') })
      result.evidence.transitionScreenshot = true
      result.evidence.transition = await yellow.evaluate(el => ({ className: el.className, colour: getComputedStyle(el).getPropertyValue('--belt-color') }))
      result.evidence.runtimeBuilds = [...runtimeBuilds]
      const after = await fetch(`${base}/version.json`, { signal: AbortSignal.timeout(15000), cache: 'no-store' }).then(r => r.json())
      result.evidence.afterBuild = after.buildNumber
      if (after.buildNumber !== version.buildNumber || !runtimeBuilds.has(version.buildNumber)) {
        throw new Error('Deployed build changed or running bundle identity was not proven')
      }
      result.notes.push('Candidate yellow transition observed; requires evidence review before extending the runner')
      break
    }
    console.log(`OBSERVE — first-belt-change :: ${body.replaceAll('\n', ' ').slice(-450)}`)
    await page.waitForTimeout(15000)
  }
  await page.screenshot({ path: join(out, 'last-screen.png') })
  if (interrupted) result.notes.push('Probe interrupted; step incomplete')
  if (!result.notes.length) result.notes.push('No first belt transition observed within the probe budget')
} catch (e) {
  result.notes.push(e.message.split('\n')[0])
} finally {
  if (browser) await browser.close()
  const decision = firstBeltVerdict(result.evidence)
  result.verdict = decision.verdict
  result.notes.push(decision.note)
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(`${result.verdict.toUpperCase()} — first-belt-change :: ${result.notes.join('; ')}`)
  console.log(`Evidence: ${out}`)
}
process.exitCode = result.verdict === 'pass' ? 0 : result.verdict === 'fail' ? 1 : 2
