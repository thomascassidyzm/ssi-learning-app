// #676 — decisive: does the BROWSER HTTP CACHE serve the anonymous 19-seed
// preview bundle to a subsequent AUTHORIZED request for the same URL?
// /api/courses/:code/bundle answers with `private, max-age=300` and NO
// `Vary: Authorization`, so any cache is entitled to reuse it.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const EMAIL = process.env.PROBE_EMAIL
const serviceKey = readFileSync(process.env.REPO + '/.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const gl = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method:'POST', headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink',email:EMAIL}) }).then(r=>r.json())
const session = await fetch(`${SB_URL}/auth/v1/verify`, { method:'POST', headers:{apikey:ANON_KEY,'Content-Type':'application/json'}, body: JSON.stringify({type:'magiclink',token_hash: gl.hashed_token}) }).then(r=>r.json())
// NOTE: no page.route() here — request interception disables Chromium's HTTP
// cache, which is the very thing under test. Service workers blocked so the
// only cache in play is the browser's own.
const browser = await chromium.launch()
const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
await page.goto(BASE + '/robots.txt').catch(() => page.goto(BASE + '/'))
const COURSES = (process.env.COURSES || 'zho_for_eng,fra_for_eng,ita_for_eng,jpn_for_eng').split(',')
for (const code of COURSES) {
  const out = await page.evaluate(async ([base, code, tok]) => {
    const url = `${base}/api/courses/${code}/bundle`
    const a = await fetch(url).then(r => r.json())
    await new Promise((r) => setTimeout(r, 4000))
    const b = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json())
    const c = await fetch(url, { cache: 'reload', headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json())
    return { anon: { previewOnly: !!a.previewOnly, legos: (a.legos||[]).length },
             auth: { previewOnly: !!b.previewOnly, legos: (b.legos||[]).length },
             bust: { previewOnly: !!c.previewOnly, legos: (c.legos||[]).length } }
  }, [BASE, code, session.access_token])
  const bug = out.auth.previewOnly
  console.log(`${code}: anon=${out.anon.legos}/${out.anon.previewOnly} | AUTHORIZED(cacheable)=${out.auth.legos}/${out.auth.previewOnly} | AUTHORIZED(cache:reload)=${out.bust.legos}/${out.bust.previewOnly}  ${bug ? '<<< PAYER SERVED THE PREVIEW' : 'ok'}`)
}
await browser.close()
