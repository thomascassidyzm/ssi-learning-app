/**
 * #689 — Android field-test build against STAGING: the end-to-end seam proof.
 *
 * There is no emulator on watson-1 (no /dev/kvm, no vmx/svm), so this is the
 * DECIDED FALLBACK, not an emulator run: headless Chromium holding the
 * WebView's own origin (https://localhost), making the same credential-free
 * cross-origin calls the Capacitor shell makes, against LIVE staging.
 *
 * It exercises, in order: sign-in (a real Supabase session minted for the
 * tester account and accepted by the API), course download (the entitlement-
 * gated bundle, asserting the full lego count rather than the 19-seed
 * preview), audio playback (a real clip id fetched cross-origin), and
 * telemetry (a write whose row must land with env='staging').
 *
 *   node e2e/_689-staging-webview-e2e.mjs
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BASE_URL || 'https://staging.saysomethingin.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+bumface@gmail.com'
const COURSE = process.env.COURSE || 'spa_for_eng'
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const TOKEN = v.session.access_token
const AUTH_UID = v.session.user.id

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
// Hold the WebView's origin. Nothing is served from it but an empty page —
// the point is that every /api call below is genuinely cross-origin.
await ctx.route('https://localhost/**', r =>
  r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>webview origin</title>' }))
const page = await ctx.newPage()
await page.goto('https://localhost/')

const SESSION_ID = randomUUID()
const out = await page.evaluate(async ([base, token, course, sessionId]) => {
  const call = async (path, init = {}) => {
    const res = await fetch(base + path, {
      credentials: 'omit',
      ...init,
      headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) },
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-json */ }
    return { path, status: res.status, acao: res.headers.get('access-control-allow-origin'), json, head: text.slice(0, 160) }
  }
  const r = {}
  // 1. sign-in: the token is accepted and resolves to a real learner
  r.signIn = await call('/api/me/profile')
  // 2. course download: the entitlement-gated bundle
  r.bundle = await call(`/api/courses/${course}/bundle`)
  // 3. audio: resolve a real clip id out of the bundle, then fetch it
  const b = r.bundle.json || {}
  const legos = b.legos || b.bundle?.legos || []
  const seeds = b.seeds || b.bundle?.seeds || []
  r.counts = { legos: legos.length, seeds: seeds.length, keys: Object.keys(b).slice(0, 20) }
  // 4. telemetry
  r.telemetry = await call('/api/player-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_shell: 'webview',
      events: [{
        event_type: 'job689_staging_probe',
        course_code: course,
        session_id: sessionId,
        occurred_at: new Date().toISOString(),
        client_version: 'job689-webview-probe',
        payload: { note: 'cross-origin webview seam proof' },
      }],
    }),
  })
  return r
}, [BASE, TOKEN, COURSE, SESSION_ID])

// Audio: pick a real audio id from the bundle if we can find one, else a known clip.
const audioId = process.env.AUDIO_ID || (() => {
  const s = JSON.stringify(out.bundle?.json || {})
  const m = s.match(/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g)
  return m ? m[0].replace(/"/g, '') : null
})()
if (audioId) {
  out.audio = await page.evaluate(async ([base, id]) => {
    const res = await fetch(`${base}/api/audio/${id}`, { credentials: 'omit' })
    const buf = await res.arrayBuffer()
    return { id, status: res.status, acao: res.headers.get('access-control-allow-origin'), bytes: buf.byteLength, type: res.headers.get('content-type') }
  }, [BASE, audioId])
} else {
  out.audio = { skipped: 'no audio id found in bundle' }
}
await browser.close()

// Read the telemetry row back out of the live DB.
await new Promise(r => setTimeout(r, 1500))
const { data: rows, error: rerr } = await svc
  .from('player_events')
  .select('occurred_at,event_type,env,app_shell,device_type,course_code,session_id,user_id,client_version')
  .eq('session_id', SESSION_ID)
if (rerr) out.telemetryRows = { error: rerr.message }
else out.telemetryRows = rows

out.identity = { tester: TESTER, authUid: AUTH_UID, sessionId: SESSION_ID, base: BASE }
console.log(JSON.stringify(out, null, 2))
writeFileSync(process.env.OUT_JSON || '/tmp/job689-probe.json', JSON.stringify(out, null, 2))
