// CSP probe for the ONE path the surface walk could not reach: the presigned-S3
// direct fetch in bulkAudioDownload.ts. Drives it at the network level from
// inside a real page on the dev origin, so connect-src/media-src are judged by
// the browser exactly as they would be during a real offline download.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+bumface@gmail.com'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const projectRef = new URL(SB_URL).hostname.split('.')[0]

const svc = createClient(SB_URL, serviceKey)
const { data: rows } = await svc.from('course_audio').select('id').limit(3)
const audioIds = (rows || []).map((r) => r.id)
console.log('audio ids:', audioIds)

const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
const { data: v } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
const session = v.session

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const ctx = await browser.newContext()
await ctx.addInitScript(([key, sess]) => {
  window.__v = []
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__v.push({ directive: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile })
  })
  try { localStorage.setItem(key, JSON.stringify(sess)) } catch {}
}, [`sb-${projectRef}-auth-token`, session])

const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const result = await page.evaluate(
  async ([ids, token]) => {
    const out = { batch: null, s3Host: null, fetchOk: null, mediaOk: null, error: null }
    try {
      const res = await fetch('/api/audio/batch-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ audioIds: ids }),
      })
      const json = await res.json()
      out.batch = res.status
      const url = Object.values(json.urls || {})[0]
      if (!url) { out.error = 'no presigned url returned: ' + JSON.stringify(json).slice(0, 200); return out }
      out.s3Host = new URL(url).host

      // 1. the real path: fetch() the presigned URL directly (connect-src)
      const r = await fetch(url)
      out.fetchOk = r.status
      const blob = await r.blob()

      // 2. and play it through an <audio> element (media-src)
      const a = new Audio(URL.createObjectURL(blob))
      out.mediaOk = await new Promise((resolve) => {
        a.addEventListener('canplaythrough', () => resolve('canplaythrough'))
        a.addEventListener('error', () => resolve('error'))
        setTimeout(() => resolve('timeout'), 8000)
      })
    } catch (e) {
      out.error = String(e).slice(0, 300)
    }
    return out
  },
  [audioIds, session.access_token]
)

await page.waitForTimeout(2000)
const violations = (await page.evaluate(() => window.__v)).filter((x) => !/eruda-/.test(x.src || ''))
console.log('RESULT', JSON.stringify(result, null, 1))
console.log('VIOLATIONS', violations.length ? JSON.stringify(violations, null, 1) : '(none)')
await browser.close()
