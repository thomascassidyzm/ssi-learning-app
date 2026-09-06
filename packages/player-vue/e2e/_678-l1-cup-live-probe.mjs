// #678 live acceptance: does a Layer-1 cup COMPOSE on Welsh, and is Spanish untouched?
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL
const COURSE = process.env.COURSE
const OUT = process.env.OUT_DIR
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const warns = [], logs = [], fallbackReqs = [], phraseReqs = []
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'warning') warns.push(t)
  if (/L1 cup|cheat/i.test(t)) logs.push(`${m.type()}: ${t}`)
})
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('course_practice_phrases')) {
    phraseReqs.push(u)
    if (decodeURIComponent(u).includes('select=seed_number,lego_index,phrase_role,known_text,target_text,known_audio_id,target1_audio_id,target2_audio_id,target1_duration_ms')) fallbackReqs.push(u)
  }
})
await page.addInitScript((c) => { try { localStorage.setItem('ssi-last-course', c) } catch {} }, COURSE)
await page.goto(`${BASE}/?l1=1`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(8000)
const start = page.locator('.player-resting-state button, .resting-cta').first()
if (await start.count()) await start.click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.locator('.bottom-nav .center-btn').first().click({ timeout: 8000 }).catch(() => {})

const seen = new Set(); let fired = false; let capture = 0
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000)
  for (const sel of ['.pod-turn-display', '.pod-listening-ambient', '.prompt-text', '.target-text']) {
    const n = await page.locator(sel).count()
    if (n) { const t = (await page.locator(sel).first().innerText().catch(() => '')).trim(); if (t) seen.add(`${sel}: ${t}`) }
  }
  if (i === 20) await page.screenshot({ path: `${OUT}/20s.png` })
  if (warns.some(w => /l1=1 preview cheat FIRED/.test(w))) { fired = true }
  if (fired) { capture++; await page.screenshot({ path: `${OUT}/cup-${capture}.png` }); if (capture > 25) break }
}
await page.screenshot({ path: `${OUT}/final.png`, fullPage: false })
console.log(`\n### COURSE=${COURSE} BASE=${BASE}`)
console.log('ARMED :', warns.filter(w => /cheat ARMED/.test(w)).length)
console.log('FIRED :', warns.filter(w => /FIRED/.test(w)).join(' | ') || '(none)')
console.log('preview-fallback used:', warns.filter(w => /falling back to sandwiching/.test(w)).join(' | ') || '(no)')
console.log('course_practice_phrases requests:', phraseReqs.length)
const sels = new Set(phraseReqs.map(u => (decodeURIComponent(u).match(/select=([^&]*)/)||[])[1]))
console.log('distinct select= shapes:'); [...sels].forEach(s2 => console.log('   -', String(s2).slice(0,220)))
console.log('CUP-FALLBACK queries (exact #672 select shape):', fallbackReqs.length)
if (fallbackReqs.length) console.log('  eg:', decodeURIComponent(fallbackReqs[0]).slice(0, 260))
console.log('L1/cheat console lines:'); logs.slice(0, 12).forEach(l => console.log('  ', l))
console.log('text surfaces seen:'); [...seen].slice(0, 14).forEach(t => console.log('  ', t))
console.log('other warns:'); warns.filter(w=>!/cheat/.test(w)).slice(0,8).forEach(w=>console.log('  ', w.slice(0,160)))
await browser.close()
