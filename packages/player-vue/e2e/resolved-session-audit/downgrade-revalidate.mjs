// Mid-session role-downgrade regression (Trinity audit finding #2,
// docs/trinity/admin.md): useUserRole's role refs used to be set ONCE at
// sign-in and never re-polled, so a de-platformed ssi_admin kept full admin
// UI on every screen until their next reload/sign-out. useAdminGate's
// periodic re-validation (packages/player-vue/src/composables/useAdminGate.ts)
// closes this — this script proves it against a REAL browser + REAL DB
// write, no mocks: load as ssi_admin, flip platform_role to null in the DB
// mid-session (the exact demotion write api/admin/update-user-role.ts makes),
// wait for the next revalidation tick, and assert the page bounced to '/'
// WITHOUT a reload. Restores the persona's platform_role afterwards either
// way, so re-runs are safe.
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY in env')

const sessions = JSON.parse(readFileSync(new URL('./sessions.json', import.meta.url)))
const admin = createClient(URL, SERVICE)
const ssiAdminUserId = sessions.ssi_admin.user.id

// useAdminGate's REVALIDATE_INTERVAL_MS — wait one tick past it so the
// periodic re-validation has definitely fired at least once.
const REVALIDATE_INTERVAL_MS = 60_000
const SETTLE_MARGIN_MS = 5_000

async function run() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, ['sb-swfvymspfxmnfhevgdkg-auth-token', JSON.stringify(sessions.ssi_admin)])
  const page = await ctx.newPage()

  try {
    await page.goto(BASE + '/admin/users', { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1500)
    const beforePath = new URL(page.url()).pathname
    if (beforePath !== '/admin/users') {
      throw new Error(`setup failed: expected /admin/users before demotion, got ${beforePath}`)
    }
    console.log('PASS setup: ssi_admin loaded /admin/users cleanly')

    // The exact demotion write api/admin/update-user-role.ts makes for a
    // real de-platforming — "null is permitted to clear the role".
    const { error } = await admin.from('learners').update({ platform_role: null }).eq('user_id', ssiAdminUserId)
    if (error) throw new Error(`demotion write failed: ${error.message}`)

    await page.waitForTimeout(REVALIDATE_INTERVAL_MS + SETTLE_MARGIN_MS)
    const afterPath = new URL(page.url()).pathname
    const ok = afterPath === '/'
    console.log((ok ? 'PASS' : 'FAIL') + ` revalidation: mid-session demotion → finalPath=${afterPath} (no reload triggered)`)
    return ok
  } finally {
    // Restore regardless of outcome — this persona is reused by cold-load.mjs.
    await admin.from('learners').update({ platform_role: 'ssi_admin' }).eq('user_id', ssiAdminUserId)
    await browser.close()
  }
}

const ok = await run()
console.log(ok ? '\nALL GREEN' : '\nFAILURE — see above')
process.exit(ok ? 0 : 1)
