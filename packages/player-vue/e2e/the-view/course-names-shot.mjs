// One-off evidence: THE LENS course picker + Stats boards show human display
// names, not raw course codes. Runs against DEPLOYED dev.
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/course-names-shot.mjs        (from packages/player-vue)
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const OUT = new URL('../../../../docs/the-view/course-names/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const IME_GROUP_ID = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!ok) failures++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
  [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])

async function open(path, readySel) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForSelector(readySel, { timeout: 25000 }).catch(() => {})
  await p.waitForTimeout(1500)
  return p
}

// ── 1. Node insights course picker (NodeRateEngine) — multiple courses ──
{
  const p = await open(`/admin/groups/${IME_GROUP_ID}/analytics`, '.nre-controls, .nre-status')
  const body = await p.locator('body').innerText()
  check('node insights picker shows a display name', /for [A-Z][a-z]+ speakers/.test(body))
  check('node insights picker shows NO raw course code', !/[a-z]{3}_for_[a-z]{3}/.test(body), (body.match(/[a-z]{3}_for_[a-z]{3}/) || [''])[0])
  await p.screenshot({ path: `${OUT}node-insights-picker.png`, fullPage: true })
  await p.close()
}

// ── 2. Stats · Content Friction board (course picker) ──
{
  const p = await open('/admin/stats?demo', '.board-tab')
  await p.getByText('Content Friction').click().catch(() => {})
  await p.waitForTimeout(1500)
  const body = await p.locator('body').innerText()
  check('friction board picker shows display names', /for English speakers/i.test(body))
  check('friction board shows NO raw course code', !/[a-z]{3}_for_[a-z]{3}/.test(body), (body.match(/[a-z]{3}_for_[a-z]{3}/) || [''])[0])
  await p.screenshot({ path: `${OUT}stats-friction-picker.png`, fullPage: true })
  await p.close()
}

// ── 3. Stats · Course Scoreboard (treemap of course display names) ──
{
  const p = await open('/admin/stats?demo', '.board-tab')
  await p.getByText('Course Scoreboard').click().catch(() => {})
  await p.waitForTimeout(1500)
  const body = await p.locator('body').innerText()
  check('scoreboard treemap shows display names', /for English speakers/i.test(body))
  check('scoreboard shows NO raw course code', !/[a-z]{3}_for_[a-z]{3}/.test(body), (body.match(/[a-z]{3}_for_[a-z]{3}/) || [''])[0])
  await p.screenshot({ path: `${OUT}stats-scoreboard.png`, fullPage: true })
  await p.close()
}

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
