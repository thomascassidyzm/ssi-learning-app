// Coastal-region compare walk on DEPLOYED dev. Proves, with a real admin
// session, that adding a SECOND demo region ('Coastal Districts Region') under
// IME Demo Programme lights up the REGION-level Insight view — which showed
// the k-floor empty state when there was only ONE region (a region's compare
// cohort is its PEER SCHOOLS in the programme, and every school lived inside
// the single region → zero peers).
//
// Steps:
//   1. Admin magiclink session.
//   2. POST /api/groups/:programme/demo-refresh — regenerates telemetry across
//      BOTH regions (replace semantics).
//   3. For BOTH regions, fetch /api/groups/:region/rate-compare for all 4
//      windows × rate: assert insufficientData=false, a real cohort, and the
//      entity-vs-average gap (Coastal is the slower, earlier-stage region).
//   4. Screenshot each window chip state of the region Insight UI.
//
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/coastal-region-compare-walk.mjs
//
// Screenshots land in docs/the-view/demo-refresh/.
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/demo-refresh/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const PROGRAMME_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a' // IME Demo Programme
const PILOT_REGION_ID = 'd01926e1-b1f4-4e3f-bae5-f03f2dbe15c9' // Pilot Districts Region (advanced)
const COASTAL_REGION_ID = '652bd018-4b84-477e-8e06-676d5d6a7630' // Coastal Districts Region (new, slower)
const WINDOWS = ['today', '7d', '30d', 'all']

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const accessToken = v.session.access_token

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

// ── 1+2. Refresh the whole programme (both regions) ──
const t0 = Date.now()
const resp = await fetch(`${BASE}/api/groups/${PROGRAMME_ID}/demo-refresh`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
})
const result = await resp.json().catch(() => ({}))
console.log(`refresh: HTTP ${resp.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s ::`, JSON.stringify(result))
check('refresh succeeds on the programme', resp.ok && result.success === true)
check('refresh touched learners across both regions', (result.learnersTouched ?? 0) > 40, `${result.learnersTouched}`)

// ── 3. Region-level compare API, both regions, every window ──
async function compareApi(regionId, window) {
  const r = await fetch(`${BASE}/api/groups/${regionId}/rate-compare?window=${window}&measure=rate`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return r.json()
}

const gap = {}
for (const [name, regionId] of [['Pilot', PILOT_REGION_ID], ['Coastal', COASTAL_REGION_ID]]) {
  gap[name] = {}
  for (const w of WINDOWS) {
    const j = await compareApi(regionId, w)
    const ok = j.insufficientData === false && j.entity && j.average && j.cohortSize >= 1
    check(`${name} region · ${w} · full compare renders`, ok,
      ok ? `entity=${j.entity.value} avg=${j.average.value} Δ=${j.deltaPct}% pct=${j.percentile} cohort=${j.cohortSize} compareTo="${j.average.label}"`
         : `insufficient=${j.insufficientData} reason="${j.reason || ''}" cohort=${j.cohortSize}`)
    if (ok) gap[name][w] = { entity: j.entity.value, avg: j.average.value, delta: j.deltaPct }
  }
}

// The two regions must be MEANINGFULLY different: Coastal (new, low current_seed)
// sits below its peer average; Pilot (advanced) sits above. Check on 30d (the
// default, most-populated window).
const pilot30 = gap.Pilot['30d'], coastal30 = gap.Coastal['30d']
if (pilot30 && coastal30) {
  check('Pilot region reads ABOVE its peer (Coastal) average on rate', pilot30.entity >= pilot30.avg,
    `Pilot entity=${pilot30.entity} vs avg=${pilot30.avg}`)
  check('Coastal region reads BELOW its peer (Pilot) average on rate', coastal30.entity <= coastal30.avg,
    `Coastal entity=${coastal30.entity} vs avg=${coastal30.avg}`)
  check('the two regions differ meaningfully on rate (entity values)', Math.abs(pilot30.entity - coastal30.entity) >= 0.5,
    `Pilot=${pilot30.entity} Coastal=${coastal30.entity}`)
}

// ── 4. Screenshot each window chip state of the region Insight UI ──
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

async function shot(regionId, tag, window) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/groups/${regionId}/analytics?window=${window}&measure=rate`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector('.niv', { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(2500)
  const body = await p.locator('body').innerText().catch(() => '')
  await p.screenshot({ path: `${OUT}coastal-compare-${tag}-${window}.png`, fullPage: true })
  await p.close()
  return body
}

for (const w of WINDOWS) {
  const body = await shot(COASTAL_REGION_ID, 'coastal', w)
  check(`Coastal Insight UI · ${w} · not the empty state`, !/Not enough data/i.test(body))
}
// one Pilot shot at default window to show the other direction of the compare
const pilotBody = await shot(PILOT_REGION_ID, 'pilot', '30d')
check('Pilot Insight UI · 30d · not the empty state', !/Not enough data/i.test(pilotBody))

await browser.close()
console.log('\nRATE GAP (entity value by region/window):')
for (const name of ['Pilot', 'Coastal']) console.log(`  ${name}:`, JSON.stringify(gap[name]))
console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
