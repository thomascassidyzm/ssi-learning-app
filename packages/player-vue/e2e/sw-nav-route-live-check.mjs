// Live check on the dev deployment: navigations must be handled by the
// NetworkFirst route, not the precache. Evidence: navigation-cache is
// populated by a reload (the precache route would never write there).
import { chromium } from '@playwright/test'
const BASE = process.argv[2] || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const ctx = await b.newContext(); const p = await ctx.newPage()
await p.goto(BASE + '/', { waitUntil: 'load' })
await p.evaluate(() => navigator.serviceWorker.ready)
await p.reload({ waitUntil: 'load' })
await p.waitForTimeout(4000)
const out = await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  const names = await caches.keys()
  const nav = names.find(n => n === 'navigation-cache')
  const navUrls = nav ? (await (await caches.open(nav)).keys()).map(r => r.url) : []
  return {
    controlled: !!navigator.serviceWorker.controller,
    waiting: reg?.waiting?.state ?? null,
    booted: window.__SSI_BOOTED === true,
    caches: names, navUrls,
  }
})
console.log(JSON.stringify(out, null, 1))
console.log(out.controlled && out.booted && out.navUrls.length > 0
  ? 'PASS — SW controls the page, app boots, navigations went through the NetworkFirst route'
  : 'FAIL')
await b.close()
