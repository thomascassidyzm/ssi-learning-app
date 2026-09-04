// CONTROL: the same page origin (https://localhost) against a deployment whose
// build has NO api/_utils/cors.ts (staging). If the 200 above were an artefact
// of the probe rather than the CORS layer, this would succeed too.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const TOKEN = readFileSync(process.argv[2], 'utf8').trim()
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true })
await ctx.route('https://localhost/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>origin holder</title>' }))
const p = await ctx.newPage()
await p.goto('https://localhost/')
const out = {}
for (const [name, origin] of [['dev (has cors.ts)', 'https://ssi-learning-app-git-dev-zenjin.vercel.app'], ['staging (no cors.ts)', 'https://staging.saysomethingin.app']]) {
  out[name] = await p.evaluate(async ([o, t]) => {
    try { const r = await fetch(o + '/api/me/profile', { headers: { Authorization: 'Bearer ' + t } }); return { status: r.status, readable: (await r.text()).slice(0, 60) } }
    catch (e) { return { blocked: String(e) } }
  }, [origin, TOKEN])
}
console.log(JSON.stringify(out, null, 2))
await b.close()
