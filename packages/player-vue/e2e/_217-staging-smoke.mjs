// #217 smoke — the gate must be invisible on a normal open. It runs on EVERY
// open, so the thing most worth proving live is that it does nothing.
import { chromium } from '@playwright/test'
const BASE = process.env.BASE || 'https://staging.saysomethingin.app'
const OUT = '/home/tomcassidy/.tmpbig/probe-217-smoke'
import fs from 'node:fs'; fs.mkdirSync(OUT, { recursive: true })
const live = await fetch(`${BASE}/version.json`, { cache: 'no-store' }).then(r => r.json())
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await b.newContext({ serviceWorkers: 'allow' })
const p = await ctx.newPage()
await p.goto(BASE, { waitUntil: 'load' })
await p.waitForTimeout(15000)
await p.evaluate(() => navigator.serviceWorker.ready)
await p.reload({ waitUntil: 'load' })
await p.waitForTimeout(12000)
const overlay = await p.locator('.ssi-open-update').count()
const mounted = await p.evaluate(() => !!window.__SSI_BOOTED && document.querySelector('#app')?.children.length > 0)
const controlled = await p.evaluate(() => !!navigator.serviceWorker.controller)
await p.screenshot({ path: `${OUT}/staging-normal-open.png` })
console.log('live build', live.buildNumber, '| controlled', controlled, '| app mounted', mounted, '| update overlay count', overlay)
await b.close()
process.exit(mounted && overlay === 0 ? 0 : 1)
