// Signed-in VAD walk against dev: prove learner_lego_metrics rows AND
// cycle_prosody player_events land for a real learner, written by the deployed
// code path. Instrumented so a failure produces a precise map of where the
// chain dies (gum -> VAD init -> timing window -> prosody emit -> flush).
//
//   node packages/player-vue/e2e/_metrics-signedin-walk.mjs
//   BASE_URL=... MINUTES=6 node ...
//
// Prerequisites:
//   - /tmp/vad-walk-bursts.wav — the fake-mic speech-burst file (a plain wav of
//     spoken bursts; anything with clear voiced segments above -45 dB works).
//   - SUPABASE_SERVICE_ROLE_KEY in ~/.ssi-sentinel.env (mints the tester session
//     and reads back the rows; never used by the app path under test).
//   - Playwright's chromium needs libnspr4/libnss3 etc. On a box without them
//     installed system-wide, extract the debs once and run with
//     LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu.
//
// Verified 2026-08-03 against dev @ d7208c38: 8 cycle_prosody rows + 3
// learner_lego_metrics rows from one 2.5-minute walk (both were zero-ever
// before 17d82439).
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const TESTER = process.env.TESTER || 'thomas.cassidy+bumface@gmail.com'
const MINUTES = Number(process.env.MINUTES || 5)
const serviceKey = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const wavPath = '/tmp/vad-walk-bursts.wav'
if (!existsSync(wavPath)) throw new Error(`fake-mic wav missing: ${wavPath} (regenerate before running)`)
const dataDir = '/tmp/ssi-metrics-signedin-profile'
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const svc = createClient(SB_URL, serviceKey)
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: link, error: lerr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: TESTER })
if (lerr) throw lerr
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: link.properties.hashed_token })
if (verr) throw verr
const session = v.session
const { data: learner } = await svc.from('learners').select('id').eq('user_id', session.user.id).maybeSingle()
console.log(`base=${BASE}`)
console.log(`minted session for ${TESTER}, learner_id=${learner?.id}`)

const before = await svc.from('learner_lego_metrics').select('lego_id', { count: 'exact', head: true }).eq('learner_id', learner.id)
const prosBefore = await svc.from('player_events').select('id', { count: 'exact', head: true }).eq('event_type', 'cycle_prosody')
console.log(`BEFORE: learner_lego_metrics(this learner)=${before.count}  cycle_prosody(all)=${prosBefore.count}`)

const ctx = await chromium.launchPersistentContext(dataDir, {
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}`,
  ],
})
const projectRef = new URL(SB_URL).hostname.split('.')[0]
await ctx.addInitScript(([key, sess]) => {
  localStorage.setItem('ssi-has-played', 'true')
  localStorage.setItem('ssi-adaptation-consent', 'true')
  localStorage.setItem(key, JSON.stringify(sess))
  window.__gumCalls = 0
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = (...a) => { window.__gumCalls++; return orig(...a) }
}, [`sb-${projectRef}-auth-token`, session])

const page = ctx.pages()[0] || await ctx.newPage()
const prosody = []
const metricsWrites = []     // direct supabase-js REST writes to learner_lego_metrics
const interesting = []       // console lines on the adaptation/VAD chain
page.on('console', (m) => {
  const t = m.text()
  if (/VAD|SpeechTiming|Timing:|useAdaptationEngine|adaptation|Hydrated|Flush|persistence/i.test(t)) {
    interesting.push(t.slice(0, 300))
  }
})
page.on('pageerror', (e) => interesting.push('PAGEERROR ' + String(e).slice(0, 300)))
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('/api/player-events')) {
    try {
      const body = JSON.parse(req.postData() || '{}')
      for (const ev of body.events || []) if (ev?.event_type === 'cycle_prosody') prosody.push(ev)
    } catch { /* non-JSON body */ }
  }
  if (u.includes('/rest/v1/learner_lego_metrics') && req.method() !== 'GET') {
    metricsWrites.push({ method: req.method(), body: (req.postData() || '').slice(0, 200) })
  }
})
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes('/rest/v1/learner_lego_metrics') && res.request().method() !== 'GET') {
    let detail = ''
    if (res.status() >= 300) { try { detail = (await res.text()).slice(0, 300) } catch { /* body consumed */ } }
    interesting.push(`REST ${res.request().method()} learner_lego_metrics -> ${res.status()} ${detail}`)
  }
})

await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(4000)
for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
  const btn = page.locator(sel).first()
  if (await btn.count()) { try { await btn.click({ timeout: 8000 }); console.log('clicked', sel); break } catch { /* not clickable */ } }
}

const ticks = Math.ceil((MINUTES * 60) / 15)
for (let i = 0; i < ticks; i++) {
  await page.waitForTimeout(15000)
  const gum = await page.evaluate(() => window.__gumCalls)
  console.log(`t+${(i + 1) * 15}s gum=${gum} prosody_on_wire=${prosody.length} metrics_writes=${metricsWrites.length}`)
  if (prosody.length >= 4 && metricsWrites.length >= 1 && i >= 5) break
}
// pagehide triggers the adaptation engine's final flush
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
await page.waitForTimeout(4000)
await ctx.close()

const after = await svc.from('learner_lego_metrics')
  .select('lego_id,course_code,mastery_state,recent_latency_samples,last_seen_at')
  .eq('learner_id', learner.id)
const pros = await svc.from('player_events').select('id', { count: 'exact', head: true }).eq('event_type', 'cycle_prosody')

console.log('\n===== CHAIN TRACE (console) =====')
for (const l of interesting.slice(0, 60)) console.log(' ', l)
console.log('\n===== RESULT =====')
console.log('prosody events on wire :', prosody.length)
console.log('metrics REST writes    :', metricsWrites.length)
console.log('learner_lego_metrics rows AFTER:', after.data?.length ?? `ERR ${after.error?.message}`)
console.log(JSON.stringify(after.data?.slice(0, 3), null, 1))
console.log('cycle_prosody rows in DB now   :', pros.count)
