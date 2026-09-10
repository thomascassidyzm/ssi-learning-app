#!/usr/bin/env node
// Qualification test for the EXISTING shared detector, not a staging test.
// Exit 1 means silent PCM was misclassified as lesson audio. No account/API
// access, no requests leave Chromium, one browser, one one-second silent WAV.
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHROME_PATH, instrument, waitAudible } from './journeys/lib.mjs'

if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH is required')
const out = join(process.env.CS_SCRATCH, 'tmp', 'release-audible-control')
mkdirSync(out, { recursive: true })
const wav = Buffer.alloc(44 + 16000 * 2) // zero-filled PCM: precisely silent
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
const shell = CHROME_PATH.replace('/chromium-', '/chromium_headless_shell-')
  .replace('/chrome-linux64/chrome', '/chrome-headless-shell-linux64/chrome-headless-shell')
let browser
let result = { verdict: 'cannot-run', pcmFrames: 16000, nonzeroPcmSamples: 0 }
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (existsSync(shell) ? shell : CHROME_PATH), args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }))
  await page.addInitScript(instrument)
  await page.goto('https://release-probe.invalid/')
  await page.evaluate(bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
    window.clip = new Audio(url)
    document.querySelector('button').onclick = () => window.clip.play()
  }, [...wav])
  await page.click('button')
  const observed = await waitAudible(page, Date.now() + 4000)
  const clock = await page.evaluate(() => window.clip.currentTime)
  result = { ...result, observed, clock,
    verdict: observed ? 'red' : clock > 0.05 ? 'green' : 'cannot-run',
    note: observed ? 'Silent PCM was classified as lesson audible' : clock > 0.05 ? 'Silent PCM correctly refused' : 'Playback did not advance: negative control inconclusive' }
} catch (e) { result.note = e.message.split('\n')[0] }
finally {
  if (browser) await browser.close()
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(`${result.verdict === 'red' ? 'FAIL' : result.verdict === 'green' ? 'PASS' : 'CANNOT-RUN'} — audible silence control :: ${result.note}`)
}
process.exitCode = result.verdict === 'green' ? 0 : result.verdict === 'red' ? 1 : 2
