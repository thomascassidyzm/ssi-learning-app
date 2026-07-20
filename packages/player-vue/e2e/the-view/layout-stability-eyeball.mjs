// THE VIEW — wobble-fix eyeball evidence (companion to layout-stability-probe.mjs).
// Verifies the correctness half of the fix on a DEPLOYED build:
//   · context bar stays mounted (no flicker) across a rail switch
//   · mid-switch the identity/stat values never show the PREVIOUS node
//   · mid-switch the action bar is visibility:hidden (verbs inert)
//   · scroll position holds across the switch
//   · cold-load time to settled content; refresh affordance works and the
//     Updated stamp moves (honesty check)
// Captures JPEG frames: cold-loaded, mid-switch, settled.
//
//   node e2e/the-view/layout-stability-eyeball.mjs [baseUrl] [viewportWidth]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.argv[2] || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const WIDTH = Number(process.argv[3] || 390)
const PROJECT_REF = 'swfvymspfxmnfhevgdkg'
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`
const START = { id: '652bd018-4b84-477e-8e06-676d5d6a7630', name: 'Coastal Districts Region' }
const SIBLING = 'Pilot Districts Region'

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const f of ['/Users/tomcassidy/SSi/ssi-learning-app/.env.local', '/Users/tomcassidy/SSi/ssi-learning-app/.env']) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const i = line.indexOf('=')
        if (i < 0 || line.slice(0, i) !== name) continue
        return line.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')
      }
    } catch { /* skip */ }
  }
  return undefined
}

const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'))
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
if (le) throw le
const anon = createClient(SUPABASE_URL, env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
const { data: v, error: ve } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (ve) throw ve
console.log('admin session ok ·', BASE, '·', WIDTH + 'px')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: 844 } })
await page.addInitScript(([authKey, sess, roleCache]) => {
  window.localStorage.setItem(authKey, sess)
  window.localStorage.setItem('ssi-user-role', roleCache)
  // Context-bar flicker ledger: watch mounts/unmounts of .entity-context-bar.
  window.__ctxLog = []
  new MutationObserver(() => {
    const present = !!document.querySelector('.entity-context-bar')
    const last = window.__ctxLog[window.__ctxLog.length - 1]
    if (!last || last.present !== present) window.__ctxLog.push({ t: performance.now(), present })
  }).observe(document.documentElement, { childList: true, subtree: true })
}, [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(v.session), JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null })])

// ── cold load timing ──
const t0 = Date.now()
await page.goto(`${BASE}/admin/groups/${START.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => {
  const el = document.querySelector('.node-home')
  return el && !el.innerText.includes('Loading')
}, null, { timeout: 30000 })
console.log(`cold load → settled content: ${Date.now() - t0}ms`)
await page.waitForTimeout(800)
await page.screenshot({ path: `/tmp/eyeball-${WIDTH}-1-coldload.jpg`, type: 'jpeg', quality: 55 })

// ── switch with mid-flight sampling ──
const toggle = page.locator('.rail-toggle')
if ((await toggle.count()) && !(await page.locator('.rail-sublist').count())) await toggle.click()
await page.waitForTimeout(300)
await page.evaluate(() => window.scrollTo(0, 120))
await page.waitForTimeout(200)

const beforeName = await page.locator('.identity-name').innerText()
const beforeScroll = await page.evaluate(() => window.scrollY)
const ctxMark = await page.evaluate(() => window.__ctxLog.length)
await page.locator('.map-rail .rail-link', { hasText: SIBLING }).first().click()

// Sample every ~40ms until settled: what do identity/verbs/context bar show?
const samples = []
for (let i = 0; i < 60; i++) {
  samples.push(await page.evaluate(() => {
    const name = document.querySelector('.identity-name')?.innerText ?? null
    const bar = document.querySelector('.node-actions')
    return {
      name,
      ctxPresent: !!document.querySelector('.entity-context-bar'),
      ctxText: document.querySelector('.entity-context-bar')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      barHidden: bar ? getComputedStyle(bar).visibility === 'hidden' : null,
      statSample: document.querySelector('.stat-value')?.innerText ?? null,
      scrollY: window.scrollY,
    }
  }))
  if (i === 2) await page.screenshot({ path: `/tmp/eyeball-${WIDTH}-2-midswitch.jpg`, type: 'jpeg', quality: 55 })
  const s = samples[samples.length - 1]
  if (s.name && s.name !== ' ' && s.name !== beforeName) break
  await page.waitForTimeout(40)
}
await page.waitForTimeout(1000)
await page.screenshot({ path: `/tmp/eyeball-${WIDTH}-3-settled.jpg`, type: 'jpeg', quality: 55 })

const midFrames = samples.filter((s) => !s.name || s.name === ' ' || s.name === beforeName)
const staleFrames = samples.filter((s) => s.name === beforeName)
const blankFrames = samples.filter((s) => s.name === ' ' || s.name === '')
console.log(`\nswitch ${beforeName} → ${SIBLING}:`)
console.log(`  sampled frames until new name: ${samples.length} (stale-name frames: ${staleFrames.length}, blanked frames: ${blankFrames.length})`)
console.log(`  previous-node name visible mid-switch: ${staleFrames.length > 0 ? 'YES — FAIL' : 'no — PASS'}`)
const midHidden = blankFrames.every((s) => s.barHidden !== false)
console.log(`  action bar hidden in every blanked frame: ${midHidden ? 'yes — PASS' : 'NO — FAIL'}`)
const staleStats = blankFrames.filter((s) => s.statSample && s.statSample !== ' ')
console.log(`  stat values blanked while switching: ${staleStats.length === 0 ? 'yes — PASS' : `NO — ${staleStats.length} frames — FAIL`}`)
const ctxDrops = samples.filter((s) => !s.ctxPresent).length
const ctxFlicker = await page.evaluate((m) => window.__ctxLog.slice(m), ctxMark)
console.log(`  context bar present in all ${samples.length} frames: ${ctxDrops === 0 ? 'yes — PASS' : `NO — dropped in ${ctxDrops} — FAIL`}; mount/unmount events during switch: ${ctxFlicker.length}`)
const scrollMoved = samples.filter((s) => s.scrollY !== beforeScroll).length
console.log(`  scroll held at ${beforeScroll}px: ${scrollMoved === 0 ? 'yes — PASS' : `moved in ${scrollMoved} frames — CHECK`}`)
console.log(`  context bar text after settle: "${samples[samples.length - 1].ctxText}"`)

// ── refresh affordance + Updated stamp honesty ──
const stampBefore = await page.locator('.updated-stamp').innerText().catch(() => '(none)')
await page.waitForTimeout(61000) // stamp shows minutes — cross a minute so movement is provable
const refresh = page.locator('.refresh-button')
if (await refresh.count()) {
  await refresh.click()
  await page.waitForTimeout(2500)
  const stampAfter = await page.locator('.updated-stamp').innerText().catch(() => '(none)')
  console.log(`  refresh affordance: clicked; stamp "${stampBefore}" → "${stampAfter}" ${stampAfter !== stampBefore ? '— moved, PASS' : '— unchanged (same minute?) CHECK'}`)
  await page.screenshot({ path: `/tmp/eyeball-${WIDTH}-4-refreshed.jpg`, type: 'jpeg', quality: 55 })
} else {
  console.log('  refresh affordance: NOT FOUND — FAIL')
}
await browser.close()
