// Job #34c — the guest hand-off: /schools?next=/admin/insights-lab as an ssi_admin.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const U = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const KEY = fs.readFileSync('/home/tomcassidy/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const ANON = fs.readFileSync(process.env.ANON_FILE,'utf8').trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const OUT = process.env.OUT || '/home/tomcassidy/probe-34c'; fs.mkdirSync(OUT, { recursive: true })
const link = await fetch(`${U}/auth/v1/admin/generate_link`, { method:'POST', headers:H, body: JSON.stringify({ type:'magiclink', email:'thomas.cassidy+ssi@gmail.com' }) }).then(r=>r.json())
const v = await fetch(`${U}/auth/v1/verify`, { method:'POST', headers:{ apikey:ANON,'Content-Type':'application/json' }, body: JSON.stringify({ type:'magiclink', token_hash: link.hashed_token }) }).then(r=>r.json())
const session = { access_token:v.access_token, refresh_token:v.refresh_token, expires_in:v.expires_in, expires_at:Math.floor(Date.now()/1000)+(v.expires_in||3600), token_type:'bearer', user:v.user }
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] })

async function arm(name, url, roleCache) {
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true })
  const page = await ctx.newPage()
  await page.addInitScript(([k,s,rc]) => { localStorage.setItem(k, JSON.stringify(s)); if (rc) localStorage.setItem('ssi-user-role', JSON.stringify(rc)) },
    ['sb-swfvymspfxmnfhevgdkg-auth-token', session, roleCache])
  await page.goto(`${BASE}${url}`, { waitUntil:'domcontentloaded' })
  await page.waitForTimeout(10000)
  console.log(`[${name}] ${url} cache=${JSON.stringify(roleCache)} -> ${page.url()}`)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await ctx.close()
}
// The guest hand-off destination, with the admin role already cached (Tom's phone).
await arm('next-with-admin-cache', '/schools?next=/admin/insights-lab', { platformRole:'ssi_admin', educationalRole:null })
// Same, cold cache — the role lands while SchoolsContainer is mounted.
await arm('next-cold-cache', '/schools?next=/admin/insights-lab', null)
await browser.close()
