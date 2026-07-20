// FOUNDER WALK item A re-run: cold loads timed to DATA-RENDERED, not shell.
// The main walk's ready-selector (.niv) fires on the Loading shell; this waits
// until the Loading state is gone and real content (rate hero / no-data note)
// is on screen.
//
//   node --env-file=../../.env --env-file=../../.env.local \
//     e2e/the-view/founder-walk-coldloads.mjs <schoolId> <groupId> <classId>
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const OUT = new URL('../../../../docs/the-view/founder-walk/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const [schoolId, groupId, classId] = process.argv.slice(2)
if (!classId) throw new Error('usage: coldloads.mjs <schoolId> <groupId> <classId>')

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const svc = createClient(SB_URL, SERVICE)
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const anon = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
const session = v.session

const browser = await chromium.launch()
async function coldLoad(url, label, i) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(session)])
  const p = await ctx.newPage()
  const t0 = Date.now()
  await p.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  let ok = false
  try {
    // data-rendered: Loading gone AND real content present
    await p.waitForFunction(() => {
      const t = document.body.innerText
      if (/Loading/i.test(t)) return false
      return /RATE OF PROGRESS|No data|LEGOs mastered|PRACTICE HOURS/i.test(t)
    }, { timeout: 30000 })
    ok = true
  } catch {}
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (i === 0) await p.screenshot({ path: `${OUT}fw-cold2-${label.replace(/\s+/g, '-')}-${secs}s.png` })
  await ctx.close()
  return { ok, secs }
}

const targets = [
  [`/admin/schools/${schoolId}/analytics`, 'school insights'],
  [`/admin/groups/${groupId}/analytics`, 'programme insights'],
  [`/admin/classes/${classId}`, 'class home'],
]
let fails = 0
for (const [url, label] of targets) {
  const times = []
  for (let i = 0; i < 5; i++) {
    const { ok, secs } = await coldLoad(url, label, i)
    times.push(ok ? `${secs}s` : `FAIL@${secs}s`)
    if (!ok) fails++
  }
  console.log(`${fails ? 'FAIL' : 'PASS'} — cold-to-DATA ×5 — ${label}: ${times.join(' ')}`)
}
await browser.close()
process.exit(fails ? 1 : 0)
