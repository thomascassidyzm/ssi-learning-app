#!/usr/bin/env node
/**
 * Aran pad — a one-file editable markdown surface reached by one unguessable link.
 *
 * Two routes only:
 *   GET  /pad/<token>        the editing page
 *   POST /pad/<token>/save   whole-document save (text/plain body)
 * Everything else 404s with no detail.
 *
 * Binds 127.0.0.1 only; the public path in is `tailscale funnel --https=10000`.
 * No shell, no eval, no path derived from the request, no dependencies.
 *
 * Data lives OUTSIDE the repo, at ~/aran-pad-data/:
 *   original.md            frozen seed — never written after first run
 *   current.md             the live document Aran edits
 *   versions/<iso>.md      one file per successful save
 *   config.json            { token }
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')

const DATA_DIR = path.join(os.homedir(), 'aran-pad-data')
const VERSIONS_DIR = path.join(DATA_DIR, 'versions')
const ORIGINAL = path.join(DATA_DIR, 'original.md')
const CURRENT = path.join(DATA_DIR, 'current.md')
const CONFIG = path.join(DATA_DIR, 'config.json')
const PORT = 4796
const MAX_BODY = 1024 * 1024

const TOKEN = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).token
if (!TOKEN || TOKEN.length < 32) throw new Error('config.json needs a token of 32+ chars')

const PAD_PATH = '/pad/' + TOKEN
const SAVE_PATH = PAD_PATH + '/save'

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function page(text) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>How This Works — learner copy</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e8e3dd; color: #1c1a17;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: max(12px, env(safe-area-inset-top)) 12px
          max(12px, env(safe-area-inset-bottom)) 12px; min-height: 100vh; display: flex; flex-direction: column; }
  header { padding: 4px 2px 10px; }
  h1 { font-size: 17px; margin: 0 0 4px; font-weight: 600; }
  p.note { margin: 0; font-size: 14px; color: #5a534b; }
  .bar { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  #status { font-size: 14px; color: #5a534b; flex: 1; }
  #status.err { color: #a3261c; font-weight: 600; }
  button { font: inherit; padding: 8px 16px; border: 1px solid #b9b2a8; border-radius: 8px;
           background: #fff; color: #1c1a17; cursor: pointer; }
  button:active { background: #f0ece6; }
  textarea { flex: 1; width: 100%; min-height: 60vh; padding: 14px; border: 1px solid #cfc8bf;
             border-radius: 10px; background: #fff; color: #1c1a17; font-size: 16px; line-height: 1.6;
             font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             resize: vertical; -webkit-appearance: none; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>How This Works — learner-facing copy</h1>
    <p class="note">Edit anything below. Your changes save automatically and Tom sees them — no need to send them anywhere.</p>
  </header>
  <div class="bar">
    <span id="status">Loaded.</span>
    <button id="saveBtn" type="button">Save</button>
  </div>
  <textarea id="doc" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(text)}</textarea>
</div>
<script>
(function () {
  var ta = document.getElementById('doc')
  var status = document.getElementById('status')
  var btn = document.getElementById('saveBtn')
  var timer = null, inFlight = false, pending = false

  function say(msg, isErr) {
    status.textContent = msg
    status.className = isErr ? 'err' : ''
  }
  function clock() {
    var d = new Date()
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
  }
  function save() {
    if (inFlight) { pending = true; return }
    inFlight = true
    say('Saving…')
    fetch(${JSON.stringify(SAVE_PATH)}, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: ta.value
    }).then(function (r) {
      if (!r.ok) throw new Error('server said ' + r.status)
      say('Saved ' + clock())
    }).catch(function (e) {
      say('NOT SAVED — ' + e.message + '. Your text is still here; check your connection and press Save.', true)
    }).then(function () {
      inFlight = false
      if (pending) { pending = false; save() }
    })
  }
  ta.addEventListener('input', function () {
    say('Unsaved changes…')
    clearTimeout(timer)
    timer = setTimeout(save, 2000)
  })
  btn.addEventListener('click', function () { clearTimeout(timer); save() })
  window.addEventListener('beforeunload', function (e) {
    if (status.textContent.indexOf('Unsaved') === 0 || inFlight) { e.preventDefault(); e.returnValue = '' }
  })
})()
</script>
</body>
</html>`
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0]

  if (req.method === 'GET' && url === PAD_PATH) {
    let text = ''
    try { text = fs.readFileSync(CURRENT, 'utf8') } catch { return send(res, 500, 'Not ready') }
    return send(res, 200, page(text), 'text/html; charset=utf-8')
  }

  if (req.method === 'POST' && url === SAVE_PATH) {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { send(res, 413, 'Too large'); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
        fs.writeFileSync(path.join(VERSIONS_DIR, stamp + '.md'), text)
        fs.writeFileSync(CURRENT, text)
      } catch (e) {
        console.error('save failed:', e.message)
        return send(res, 500, 'Save failed')
      }
      return send(res, 200, 'ok')
    })
    return
  }

  return send(res, 404, 'Not found')
})

fs.mkdirSync(VERSIONS_DIR, { recursive: true })
server.listen(PORT, '127.0.0.1', () => {
  console.log('aran-pad listening on 127.0.0.1:' + PORT)
})
