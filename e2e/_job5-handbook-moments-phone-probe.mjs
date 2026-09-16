import pw from '/home/tomcassidy/SSi/ssi-learning-app/node_modules/.pnpm/@playwright+test@1.58.2/node_modules/@playwright/test/index.js'
const { chromium } = pw
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('/home/tomcassidy/SSi/ssi-learning-app/.env.local','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]))
const SUPA = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const SVC = Object.fromEntries(readFileSync('/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env','utf8')
  .split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')])).SUPABASE_SERVICE_KEY
const ref = new URL(SUPA).hostname.split('.')[0]

async function session(email) {
  const gl = await fetch(`${SUPA}/auth/v1/admin/generate_link`, { method:'POST',
    headers:{ apikey:SVC, Authorization:`Bearer ${SVC}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ type:'magiclink', email }) })
  const j = await gl.json()
  if (!j.email_otp) throw new Error('no otp for '+email+': '+JSON.stringify(j).slice(0,300))
  const v = await fetch(`${SUPA}/auth/v1/verify`, { method:'POST',
    headers:{ apikey:ANON, 'Content-Type':'application/json' },
    body: JSON.stringify({ type:'magiclink', email, token: j.email_otp }) })
  const s = await v.json()
  if (!s.access_token) throw new Error('no token for '+email+': '+JSON.stringify(s).slice(0,300))
  return s
}

const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const browser = await chromium.launch({ executablePath: process.env.CHROME })
const roles = [
  ['teacher', 'thomas.cassidy+chepstowtest-cover@gmail.com', ['/schools/handbook','/schools/classes','/schools']],
  ['leader',  'thomas.cassidy+chepstowtest-leader@gmail.com', ['/schools/handbook','/schools/teachers','/schools/classes']],
]
for (const [label, email, paths] of roles) {
  const s = await session(email)
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
  await ctx.addInitScript(([k, val]) => { localStorage.setItem(k, val) }, [`sb-${ref}-auth-token`, JSON.stringify(s)])
  const page = await ctx.newPage()
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil:'networkidle', timeout:60000 }).catch(()=>{})
    await page.waitForTimeout(2500)
    const slug = p.replace(/\//g,'_')
    await page.screenshot({ path: `${process.env.CS_SCRATCH}/shot-${label}${slug}.png`, fullPage: false })
    const body = await page.evaluate(() => ({
      url: location.pathname,
      moments: [...document.querySelectorAll('.section-title')].map(e=>e.textContent.trim()),
      next: [...document.querySelectorAll('.next-link')].map(e=>e.textContent.trim()),
      rows: document.querySelectorAll('.entry').length,
      showMe: [...document.querySelectorAll('[data-walk-offer]')].map(e=>e.getAttribute('data-walk-offer')),
      chip: document.querySelector('[data-walk-offer-list]')?.textContent?.trim() ?? null,
      readLot: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/Read the lot|Just what/.test(t)),
    }))
    console.log(label, JSON.stringify(body))
  }
  await ctx.close()
}
await browser.close()
