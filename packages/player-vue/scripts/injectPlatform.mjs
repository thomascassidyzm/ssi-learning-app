#!/usr/bin/env node
/**
 * injectPlatform — stamps `window.__SSI_PLATFORM__` into a BUILT index.html.
 *
 * Why post-build injection rather than a VITE_ build var: the wrapper wraps the
 * SAME artefact the web serves. Keeping the shell configuration out of the Vite
 * build means the web bundle is byte-identical to today's and there is no
 * second build to keep in step — the wrapper just stamps the one line the
 * platform seam reads (src/platform/capabilities.ts) ahead of the module
 * script, so it is set before the app bundle evaluates.
 *
 * Usage:
 *   node scripts/injectPlatform.mjs dist/index.html https://api-origin.example
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , file, apiOrigin] = process.argv
if (!file || !apiOrigin) {
  console.error('usage: injectPlatform.mjs <index.html> <apiOrigin>')
  process.exit(1)
}

const MARK = '__SSI_PLATFORM__'
let html = readFileSync(file, 'utf8')
if (html.includes(MARK)) {
  console.log('injectPlatform: already stamped, leaving alone')
  process.exit(0)
}

const tag = `<script>window.${MARK}={shell:'webview',apiOrigin:${JSON.stringify(apiOrigin)}};</script>`
// First inline script in <head> wins: it must run before /src/main.js.
const at = html.indexOf('<head>')
if (at === -1) {
  console.error('injectPlatform: no <head> in ' + file)
  process.exit(1)
}
html = html.slice(0, at + 6) + '\n    ' + tag + html.slice(at + 6)
writeFileSync(file, html)
console.log(`injectPlatform: shell=webview apiOrigin=${apiOrigin} -> ${file}`)
