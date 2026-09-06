import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync(process.env.ENVFILE || './.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const URL_ = env.SUPABASE_URL.replace(/\/$/,'')
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
export async function rest(path, {count}={}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
  if (count) headers.Prefer = `count=${count}`
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers })
  const cr = res.headers.get('content-range')
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`${res.status} ${path} :: ${text.slice(0,300)}`)
  return { data, total: cr ? Number(cr.split('/')[1]) : null }
}
export async function all(path, pageSize=1000) {
  const out=[]; let off=0
  for(;;){ const sep = path.includes('?')?'&':'?'
    const {data} = await rest(`${path}${sep}limit=${pageSize}&offset=${off}`)
    out.push(...data); if (data.length<pageSize) break; off+=pageSize }
  return out
}
if (process.argv[2]) { const r = await rest(process.argv[2], {count:'exact'}); console.log(JSON.stringify(r.data).slice(0,4000)); console.error('total=',r.total) }
