// Shared live-DB helper for the a159 adoption-numbers measurement scripts.
// READ-ONLY. Service-role creds from the dashboard repo's .env.
import fs from 'node:fs'

const ENV = '/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env'
const env = Object.fromEntries(
  fs.readFileSync(ENV, 'utf8').split('\n')
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
)
export const URL_ = env.SUPABASE_URL
export const KEY = env.SUPABASE_SERVICE_KEY

export async function rest(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`)
  return { rows: JSON.parse(text), count: Number((res.headers.get('content-range') || '').split('/')[1]) }
}

/** HEAD-style exact count without pulling rows. */
export async function count(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}${path.includes('?') ? '&' : '?'}select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 300)}`)
  return Number((res.headers.get('content-range') || '').split('/')[1])
}

/** Keyset pagination — never offset (deep offset blows the statement timeout). */
export async function all(table, select, filters = '', keyCol = 'id', page = 5000) {
  const out = []
  let last = null
  for (;;) {
    const cursor = last === null ? '' : `&${keyCol}=gt.${encodeURIComponent(last)}`
    const { rows } = await rest(`${table}?select=${select}&order=${keyCol}.asc&limit=${page}${filters}${cursor}`)
    out.push(...rows)
    if (rows.length < page) break
    last = rows[rows.length - 1][keyCol]
  }
  return out
}
