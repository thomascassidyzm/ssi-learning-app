// MEMBER MOUNT verify — 2026-07-20. Mint a FRESH personal leader link on the
// IME demo tree, redeem it in a clean context on the deployed build, and
// assert the landing IS THE VIEW's node home at member scope:
//   rail (you're here, rooted at their top node, NO admin escape) · identity ·
//   stats row · children list + lens chips · See insights · Updated stamp ·
//   invite verbs only (no admin structural verbs). Then drill school → class
//   (flat student rows) and open insights. Screenshots to /tmp/member-mount/.
//   BASE_URL=<deployment> node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/member-mount-verify.mjs        (from packages/player-vue)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = '/tmp/member-mount/'
mkdirSync(OUT, { recursive: true })

const PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })

const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const adminToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

// ─── Mint a fresh personal programme-leader link ───
const resp = await fetch(`${BASE}/api/groups/${PROGRAMME}/invites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ role: 'leader', limits: {}, personal: { name: 'Member Mount Probe' } }),
})
const mint = await resp.json()
if (!resp.ok) { console.error('mint failed:', resp.status, mint.error); process.exit(1) }
console.log('MINTED leader link:', mint.code, mint.url)

const browser = await chromium.launch()
const shots = []
async function walk(width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  const shot = async (name) => { const f = `${OUT}${tag}-${name}.png`; await p.screenshot({ path: f, fullPage: false }); shots.push(f) }

  // 1. Redeem fresh → must land on /schools/org/<programme>
  await p.goto(mint.url, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForURL((u) => u.pathname.startsWith('/schools'), { timeout: 45000 }).catch(() => {})
  await p.waitForTimeout(6000)
  const landPath = new URL(p.url()).pathname
  check(`${tag}: leader lands on member node home`, landPath === `/schools/org/${PROGRAMME}`, p.url())
  const body = (await p.textContent('body').catch(() => '')) || ''
  check(`${tag}: rail you-are-here`, body.includes("you're here"))
  check(`${tag}: identity names the node`, body.includes('IME Demo Programme'))
  check(`${tag}: stats row words`, body.includes('Learners') && body.includes('Teachers') && body.includes('Classes') && body.includes('Practice hours'))
  check(`${tag}: lens chips`, body.includes('All schools') && body.includes('All teachers'))
  check(`${tag}: See insights verb`, body.includes('See insights'))
  check(`${tag}: Updated stamp`, /Updated/.test(body))
  check(`${tag}: NO admin escape`, !body.includes('All organisations'))
  check(`${tag}: NO admin structural verbs`, !body.includes('Mint a demo org') && !body.includes('Delete'))
  check(`${tag}: invite verbs present`, body.includes('Invite a person') && body.includes('Get a shareable link'))
  await shot('1-landing')

  // 2. Drill into a school from the children list → stays in /schools/org.
  // The IME tree is programme → region → school, so go through Pilot Districts
  // Region first (Sunrise lives under it), not straight to a school row.
  const regionRow = p.locator('.child-btn', { hasText: 'Pilot Districts Region' }).first()
  if (await regionRow.count()) { await regionRow.click(); await p.waitForTimeout(4500) }
  const schoolRow = p.locator('.child-btn', { hasText: 'Sunrise' }).first()
  if (await schoolRow.count()) {
    await schoolRow.click()
    await p.waitForTimeout(4500)
    const drillPath = new URL(p.url()).pathname
    check(`${tag}: school drill stays in member scope`, drillPath.startsWith('/schools/org/'), p.url())
    const sbody = (await p.textContent('body').catch(() => '')) || ''
    check(`${tag}: school home renders`, sbody.includes('Sunrise') && sbody.includes("you're here"))
    await shot('2-school')

    // 3. Drill a class (classes lens keeps it simple)
    const classChip = p.locator('.chip', { hasText: 'All classes' }).first()
    if (await classChip.count()) {
      await classChip.click()
      await p.waitForTimeout(3500)
      const classRow = p.locator('.child-btn').first()
      if (await classRow.count()) {
        await classRow.click()
        await p.waitForTimeout(4500)
        const cbody = (await p.textContent('body').catch(() => '')) || ''
        check(`${tag}: class home in member scope`, new URL(p.url()).pathname.startsWith('/schools/org/'), p.url())
        check(`${tag}: class teaching cards`, cbody.includes('Course journey') && cbody.includes('Belt distribution'))
        await shot('3-class')
      }
    }
  } else {
    check(`${tag}: school child row present`, false, 'no Sunrise row found')
  }

  // 4. Insights lens from the programme home
  await p.goto(`${BASE}/schools/org/${PROGRAMME}/insights`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(6000)
  const ibody = (await p.textContent('body').catch(() => '')) || ''
  check(`${tag}: insights renders at member mount`, ibody.includes('Insights') && ibody.includes('IME Demo Programme'))
  check(`${tag}: insights has Overview back-verb, no All boards`, ibody.includes('Overview') && !ibody.includes('All boards'))
  await shot('4-insights')

  check(`${tag}: zero page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await walk(1280, 900, 'desktop')
await walk(390, 844, 'phone')

await browser.close()

// ─── Cleanup the probe account + link (throwaway, not part of the demo pack) ───
if (mint.code) await svc.from('invite_codes').delete().eq('code', mint.code)
if (mint.account?.auth_user_id) {
  await svc.from('govt_admins').delete().eq('user_id', mint.account.auth_user_id)
  await svc.from('user_tags').delete().eq('user_id', mint.account.auth_user_id)
  await svc.from('learners').delete().eq('user_id', mint.account.auth_user_id)
  await svc.auth.admin.deleteUser(mint.account.auth_user_id)
  console.log('CLEANED probe account', mint.account.auth_user_id)
}

console.log(shots.join('\n'))
console.log(failures ? `\n${failures} FAILURES` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
