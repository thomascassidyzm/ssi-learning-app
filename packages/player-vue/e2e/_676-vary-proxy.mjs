// #676 acceptance harness — a thin pass-through to the deployed dev API that
// injects the ONE header this branch adds server-side (`Vary: Authorization`)
// on the entitlement-personalised course endpoints. Point vite's /api proxy at
// this and the browser sees exactly what it will see once the branch deploys,
// with its real HTTP cache still in play (which `page.route()` would disable).
import { createServer } from 'node:http'
const UPSTREAM = process.env.UPSTREAM || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const PERSONALISED = /^\/api\/courses\/[a-z0-9_]+\/(bundle|cycles|infplay-cycles)/
createServer(async (req, res) => {
  try {
    const headers = { ...req.headers }
    delete headers.host; delete headers.connection
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))) })
    const up = await fetch(UPSTREAM + req.url, { method: req.method, headers, body, redirect: 'manual' })
    const out = {}
    up.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v })
    if (PERSONALISED.test(req.url.split('?')[0])) {
      const existing = (out['vary'] || '').split(',').map((s) => s.trim()).filter(Boolean)
      if (!existing.some((s) => s.toLowerCase() === 'authorization')) existing.push('Authorization')
      out['vary'] = existing.join(', ')
    }
    res.writeHead(up.status, out)
    res.end(Buffer.from(await up.arrayBuffer()))
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e))
  }
}).listen(Number(process.env.PORT || 5679), () => console.log('vary-proxy on', process.env.PORT || 5679, '→', UPSTREAM))
