import { chromium } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'

// cycle_prosody deployed-dev walk (VAD phase 1, founder ruling 2026-07-28).
//
// Verifies against a DEPLOYED build (default: the dev alias) that a real
// session with VAD consent emits cycle_prosody events that ARRIVE in
// player_events: assertions ride the telemetry wire (request payloads to
// /api/player-events) AND the server's insert acknowledgement ({inserted: n}
// with HTTP 200 — the endpoint 500s if the DB insert fails, so a 200 on a
// batch containing cycle_prosody proves the rows landed).
//
// Mic input is faked: Chromium's --use-file-for-fake-audio-capture plays a
// generated WAV of tone bursts (700ms on / 600ms off) so the VAD's energy
// gate (-45dB, 3 frames) confirms "speech" in every pause window. VAD
// consent is pre-seeded via localStorage before boot (the player auto-inits
// the VAD at play start when ssi-adaptation-consent === 'true').
//
// Usage: node e2e/vad-cycle-prosody-walk.mjs
//   BASE_URL=… to point elsewhere (defaults to the dev git-branch alias).

const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'

// ── Generate the fake-mic WAV: 180s of 440Hz bursts, 16-bit mono 44.1kHz ──
const wavPath = '/tmp/vad-walk-bursts.wav'
if (!existsSync(wavPath)) {
  const rate = 44100
  const seconds = 180
  const n = rate * seconds
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const inBurst = (t % 1.3) < 0.7 // 700ms tone, 600ms silence
    const sample = inBurst ? Math.sin(2 * Math.PI * 440 * t) * 0.6 : 0
    data.writeInt16LE(Math.round(sample * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  writeFileSync(wavPath, Buffer.concat([header, data]))
  console.log('fake-mic WAV written:', wavPath)
}

const dataDir = '/tmp/ssi-vad-walk-profile'
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

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
await ctx.addInitScript(() => {
  localStorage.setItem('ssi-adaptation-consent', 'true')
})
const page = ctx.pages()[0] || await ctx.newPage()

// Wire sniffer: request payloads (what the client sent) + response status
// (what the server did with it).
const prosodyEvents = []
const batchResults = [] // { hadProsody, status, inserted }
page.on('request', (req) => {
  if (!req.url().includes('/api/player-events')) return
  try {
    const body = JSON.parse(req.postData() || '{}')
    for (const ev of body.events || []) {
      if (ev?.event_type === 'cycle_prosody') prosodyEvents.push(ev)
    }
  } catch { /* beacon blobs may be unreadable — fine, next flush repeats */ }
})
page.on('response', async (res) => {
  if (!res.url().includes('/api/player-events')) return
  let hadProsody = false
  try {
    const body = JSON.parse(res.request().postData() || '{}')
    hadProsody = (body.events || []).some((e) => e?.event_type === 'cycle_prosody')
  } catch { /* unreadable */ }
  let inserted = null
  try { inserted = (await res.json())?.inserted ?? null } catch { /* non-JSON */ }
  batchResults.push({ hadProsody, status: res.status(), inserted })
})

const clickPlay = async () => {
  for (const sel of ['.center-btn', 'button:has-text("Start")', 'button:has-text("Continue")']) {
    const btn = page.locator(sel).first()
    if (await btn.count()) { try { await btn.click({ timeout: 8000 }); return sel } catch { /* next */ } }
  }
  return null
}

const waitFor = async (pred, seconds, label) => {
  for (let i = 0; i < seconds * 4; i++) {
    await page.waitForTimeout(250)
    if (await pred()) return true
    if (i % 60 === 59) console.log(`...waiting for ${label}`)
  }
  return pred()
}

const fails = []

console.log(`=== VAD cycle_prosody walk against ${BASE} ===`)
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message))
await page.waitForTimeout(3000)
console.log('clicked:', await clickPlay())

// Let several speaking cycles play out (a cycle is ~11s; batches flush every 5s).
await waitFor(() => prosodyEvents.length >= 2, 180, 'cycle_prosody events on the wire')

console.log(`cycle_prosody events captured: ${prosodyEvents.length}`)
if (prosodyEvents.length === 0) {
  fails.push('no cycle_prosody event ever hit the wire')
} else {
  const p = prosodyEvents[0]
  const pay = p.payload || {}
  console.log('first payload:', JSON.stringify(pay, null, 2))
  if (!p.session_id) fails.push('event missing session_id')
  if (!p.occurred_at) fails.push('event missing occurred_at')
  if (!pay.cycleId) fails.push('payload missing cycleId')
  if (!pay.legoId) fails.push('payload missing legoId')
  if (!pay.audioId) console.log('note: audioId null (non-proxy audio URL?)')
  if (typeof pay.responseLatencyMs !== 'number') fails.push(`responseLatencyMs not a number: ${pay.responseLatencyMs}`)
  if (typeof pay.learnerDurationMs !== 'number') fails.push(`learnerDurationMs not a number: ${pay.learnerDurationMs}`)
  if (pay.extractorVersion !== 1) fails.push(`extractorVersion !== 1: ${pay.extractorVersion}`)
  if (!pay.envelope) console.log('note: envelope null this cycle (no confirmed speech window)')
  else {
    if (typeof pay.envelope.peakCount !== 'number') fails.push('envelope present but peakCount not a number')
    // Schema steer: the intermediate-feature contour must ride the event.
    const c = pay.envelope.contour
    if (!Array.isArray(c) || c.length === 0) fails.push('envelope present but contour missing/empty')
    else if (c.length > 128) fails.push(`contour longer than the 128-point cap: ${c.length}`)
    else if (!c.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)) fails.push('contour values not 0-100 ints')
    if (typeof pay.envelope.contourGridMs !== 'number') fails.push('envelope present but contourGridMs missing')
  }
  if (!pay.learnerId) fails.push('payload missing learnerId (guest attribution)')
}

// Server-side arrival: at least one batch that contained cycle_prosody must
// have been accepted (200 + inserted count).
await page.waitForTimeout(6000) // let the last flush answer
const accepted = batchResults.filter((b) => b.hadProsody && b.status === 200 && b.inserted > 0)
console.log(`batches containing cycle_prosody accepted by the server: ${accepted.length}`)
if (prosodyEvents.length > 0 && accepted.length === 0) {
  fails.push('cycle_prosody batches were sent but none was acknowledged with 200 {inserted}')
}

await ctx.close()

if (fails.length) {
  console.log('\nFAIL:')
  for (const f of fails) console.log(' -', f)
  process.exit(1)
}
console.log('\nPASS: cycle_prosody emitted with correct payload shape and accepted into player_events')
