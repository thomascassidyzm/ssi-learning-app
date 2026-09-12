#!/usr/bin/env node
// Positive companion to release-audible-control: a real, non-zero blob WAV.
// No remote traffic; uses the unchanged shared journeys instrument.
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHROME_PATH, instrument, waitAudible } from './journeys/lib.mjs'
if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH is required')
const wav = Buffer.alloc(44 + 16000 * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < 16000; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / 16000)), 44 + i * 2)
const shell = CHROME_PATH.replace('/chromium-', '/chromium_headless_shell-')
  .replace('/chrome-linux64/chrome', '/chrome-headless-shell-linux64/chrome-headless-shell')
let browser
let result = { verdict: 'cannot-run', pcmFrames: 16000, amplitude: 12000 }
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (existsSync(shell) ? shell : CHROME_PATH), args: ['--no-sandbox'] })
  const page = await browser.newPage({ serviceWorkers: 'block' })
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }))
  await page.addInitScript(instrument)
  await page.goto('http://localhost:4173/')
  await page.evaluate(bytes => {
    window.clip = new Audio(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })))
    document.querySelector('button').onclick = () => window.clip.play()
  }, [...wav])
  await page.click('button')
  const observed = await waitAudible(page, Date.now() + 4000)
  const clock = await page.evaluate(() => window.clip.currentTime)
  result = { ...result, observed, clock, verdict: clock <= 0.05 ? 'cannot-run' : observed ? 'green' : 'red' }
} catch (e) { result.error = e.message.split('\n')[0] }
finally {
  if (browser) await browser.close()
  const out = join(process.env.CS_SCRATCH, 'tmp', 'release-blob-control')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
process.exitCode = result.verdict === 'green' ? 0 : result.verdict === 'red' ? 1 : 2
