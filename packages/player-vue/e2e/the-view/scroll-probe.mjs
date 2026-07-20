// Founder pass A §3 — scroll-bug probe. For each main admin surface, at
// laptop + phone viewport heights, measure whether the page can actually be
// scrolled to its true bottom (body carries overflow:hidden app-wide, so a
// full-page container that doesn't own overflow-y:auto strands its content).
//
//   node --env-file=../../.env --env-file=../../.env.local e2e/the-view/scroll-probe.mjs
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'

const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const svc = createClient(SB_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
const anon = createClient(SB_URL, (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(SB_URL).hostname.split('.')[0]
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: process.env.ADMIN_EMAIL || 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr

// Demo tree ids (3-tier demo, docs/demo-refresh)
const CLASS_ID = 'e2bbe2de-cada-4aed-908a-4b36d26ca95c' // Grade 6A, Sunrise Pune

// Find a demo group id for the group surfaces.
const { data: groups } = await svc.from('groups').select('id, name, type').eq('is_demo', true).limit(5)
const groupId = groups?.[0]?.id

const PAGES = [
  ['/admin/structure', 'Structure'],
  [`/admin/groups/${groupId}`, 'Group node home'],
  [`/admin/groups/${groupId}/analytics`, 'Group insights'],
  [`/admin/classes/${CLASS_ID}`, 'Class node home'],
  [`/admin/classes/${CLASS_ID}/insights`, 'Class insights'],
  ['/admin/users', 'Admin users'],
  ['/admin/invites', 'Invites'],
  ['/admin/stats', 'Stats boards'],
  ['/methodology', 'Methodology'],
]

const VIEWPORTS = [
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 700 },
]

const browser = await chromium.launch()
let failures = 0
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) },
    [`sb-${projectRef}-auth-token`, JSON.stringify(v.session)])
  const p = await ctx.newPage()
  for (const [path, label] of PAGES) {
    try {
      await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
      await p.waitForTimeout(2500)
      const r = await p.evaluate(() => {
        // The element that would need to scroll: the tallest scroll owner.
        const doc = document.scrollingElement
        const bodyOverflow = getComputedStyle(document.body).overflow
        // find candidate scroll containers
        const els = [...document.querySelectorAll('*')]
        let overflowOwner = null
        for (const el of els) {
          const cs = getComputedStyle(el)
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
            if (!overflowOwner || el.scrollHeight > overflowOwner.scrollHeight) overflowOwner = el
          }
        }
        const contentHeight = Math.max(doc.scrollHeight, document.body.scrollHeight)
        const needsScroll = contentHeight > window.innerHeight + 8
        const docCanScroll = bodyOverflow !== 'hidden' && doc.scrollHeight > doc.clientHeight + 8
        return {
          needsScroll,
          docCanScroll,
          bodyOverflow,
          contentHeight,
          viewport: window.innerHeight,
          ownerTag: overflowOwner ? `${overflowOwner.tagName}.${String(overflowOwner.className).split(' ')[0]}` : null,
          ownerScrollable: Boolean(overflowOwner),
        }
      })
      const scrollable = !r.needsScroll || r.docCanScroll || r.ownerScrollable
      const status = scrollable ? 'PASS' : 'FAIL'
      if (!scrollable) failures++
      console.log(`${status} — [${vp.name}] ${label} :: needsScroll=${r.needsScroll} content=${r.contentHeight} vh=${r.viewport} bodyOverflow=${r.bodyOverflow} owner=${r.ownerTag}`)
    } catch (e) {
      failures++
      console.log(`FAIL — [${vp.name}] ${label} :: ${e.message}`)
    }
  }
  await ctx.close()
}
await browser.close()
console.log(failures ? `\n${failures} scroll failures` : '\nAll surfaces scrollable')
process.exit(failures ? 1 : 0)
