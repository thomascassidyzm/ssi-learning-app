#!/usr/bin/env node
// CONTROLS for the shared audible detector. Not a staging test: no account,
// no API access, no request leaves Chromium, one browser, three clips.
//
//   1. SILENCE      one second of zero PCM        must be REFUSED
//   2. CLICK-AT-END 90% silence, one short blip   must be REFUSED
//   3. REAL CLIP    a bundled lesson mp3          must be HEARD
//
// A detector that only passes (1) can be got by returning false. A detector
// that only passes (3) can be got by returning true. All three together are
// what make the check worth anything.
//
// Exit 0 = all three correct. 1 = a control gave the wrong verdict.
// 2 = a control could not run (playback never advanced), which is inconclusive
// and must never read as a pass.
//
// Run: nice -n 15 ionice -c 3 node packages/player-vue/e2e/release-audible-control.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_PATH, instrument, waitAudible } from './journeys/lib.mjs'
import { AUDIBILITY } from './journeys/audibility.mjs'

if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH is required')
const out = join(process.env.CS_SCRATCH, 'tmp', 'release-audible-control')
mkdirSync(out, { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))

// ── clips ───────────────────────────────────────────────────────────────────
const wav = (samples) => {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4)
  b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(b.length - 44, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2)
  return b
}
const silent = wav(new Int16Array(16000)) // precisely silent: 16,000 zero samples
// 2s: 1.9s of silence then 100ms of full-scale tone. Technically "audible" at
// one instant, and a learner heard no word.
const click = (() => {
  const s = new Int16Array(32000)
  for (let i = 30400; i < 32000; i++) s[i] = Math.round(20000 * Math.sin((2 * Math.PI * 440 * i) / 16000))
  return wav(s)
})()
// A real recorded lesson clip, bundled in the repo — no network, no account.
const audioDir = join(here, '..', 'public', 'audio')
const realName = readdirSync(audioDir).filter((f) => f.endsWith('.mp3')).sort()[0]
const real = readFileSync(join(audioDir, realName))

const shell = CHROME_PATH.replace('/chromium-', '/chromium_headless_shell-')
  .replace('/chrome-linux64/chrome', '/chrome-headless-shell-linux64/chrome-headless-shell')

const CASES = [
  { id: 'silence',  clip: silent, expect: 'refused', label: '1s of zero PCM' },
  { id: 'click',    clip: click,  expect: 'refused', label: '2s, 95% silence + 100ms tone at the end' },
  { id: 'real',     clip: real,   expect: 'heard',   label: `bundled lesson clip ${realName}` },
]

let browser
const results = []
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || (existsSync(shell) ? shell : CHROME_PATH),
    // --mute-audio is what the journey harness itself launches with: proving
    // the analyser still sees samples under it is the whole point of using it
    // here rather than a friendlier flag set.
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  })
  for (const c of CASES) {
    const page = await browser.newPage()
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }))
    await page.addInitScript(instrument)
    await page.goto('https://release-probe.invalid/')
    await page.evaluate(([bytes, type]) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }))
      window.clip = new Audio(url)
      document.querySelector('button').onclick = () => window.clip.play()
    }, [[...c.clip], c.id === 'real' ? 'audio/mpeg' : 'audio/wav'])
    await page.click('button')
    const observed = await waitAudible(page, Date.now() + 6000)
    const state = await page.evaluate(() => ({
      clock: window.clip.currentTime,
      duration: window.clip.duration,
      // Defensive: an OLD instrument has no meters at all, and the control
      // must still deliver a verdict on it rather than dying — that is exactly
      // the code this control exists to fail.
      meters: window.__audio.meters || [],
      tapErrors: window.__audio.tapErrors || [],
      ctx: window.__audio.audioCtxState,
      lessonLevel: window.__audio.lessonLevel,
      progressed: window.__audio.firstLessonProgressed ?? null,
    }))
    const m = state.meters[0] || {}
    const heard = !!observed
    // A control that never advanced its clock proves nothing in either
    // direction, and a tap that could not be made is a gap, not silence.
    const inconclusive = state.clock <= 0.05 || state.tapErrors.length > 0
    results.push({
      id: c.id, label: c.label, expect: c.expect,
      verdict: inconclusive ? 'cannot-run' : heard === (c.expect === 'heard') ? 'correct' : 'wrong',
      heard,
      firstLessonAudibleMs: observed ? Math.round(observed.firstLessonAudible) : null,
      firstLessonProgressedMs: state.progressed ? Math.round(state.progressed) : null,
      level: {
        peakDbfs: m.peakDbfs, maxRmsDbfs: m.maxRmsDbfs,
        aboveFloorMs: Math.round(m.aboveFloorMs || 0), elapsedMs: Math.round(m.elapsedMs || 0),
        aboveFloorPct: m.aboveFloorPct,
      },
      clock: state.clock, duration: state.duration,
      audioCtxState: state.ctx, tapErrors: state.tapErrors,
    })
    await page.close()
  }
} catch (e) {
  results.push({ id: 'harness', verdict: 'cannot-run', note: e.message.split('\n')[0] })
} finally {
  if (browser) await browser.close()
}

const payload = { thresholds: AUDIBILITY, results }
writeFileSync(join(out, 'result.json'), JSON.stringify(payload, null, 2) + '\n')
for (const r of results) {
  const lv = r.level ? `peak ${r.level.peakDbfs} dBFS, rms ${r.level.maxRmsDbfs} dBFS, above floor ${r.level.aboveFloorMs}/${r.level.elapsedMs}ms = ${r.level.aboveFloorPct}%` : r.note
  console.log(`${r.verdict.toUpperCase().padEnd(10)} ${r.id.padEnd(8)} expect=${r.expect} heard=${r.heard} :: ${lv}`)
}
const bad = results.filter((r) => r.verdict === 'wrong').length
const cant = results.filter((r) => r.verdict === 'cannot-run').length
console.log(bad ? `FAIL — ${bad} control(s) gave the wrong verdict` : cant ? `CANNOT-RUN — ${cant} control(s) inconclusive` : 'PASS — all three controls correct')
process.exitCode = bad ? 1 : cant ? 2 : 0
