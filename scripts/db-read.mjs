#!/usr/bin/env node
/**
 * db-read.mjs — read-only Supabase inspector for SSi.
 *
 * SAFETY: uses the PUBLIC publishable key — the same one shipped in the browser
 * bundle that every visitor already downloads. It exposes nothing that RLS
 * doesn't already allow a logged-out visitor to read. NEVER put the service-role
 * key in this file (it bypasses RLS — keep it out of the repo and out of agent
 * sessions entirely).
 *
 * PORTABLE: the learning app and the dashboard (ssi-dashboard-v7-clean) share
 * ONE database, so this file can be copied verbatim into either repo.
 *
 * No dependencies — uses Node's built-in fetch (Node 18+). Run with `node`.
 *
 * Usage:
 *   node scripts/db-read.mjs                       # dump every algorithm_config row
 *   node scripts/db-read.mjs pods                  # one algorithm_config key (pods/stage0/listening/…)
 *   node scripts/db-read.mjs --path "course_seeds?select=seed_number,target_text&limit=5"
 *                                                  # any PostgREST query (read-only)
 */

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

const headers = { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}` }

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${body}`)
  return body ? JSON.parse(body) : null
}

async function main() {
  const argv = process.argv.slice(2)
  const pathIdx = argv.indexOf('--path')

  if (pathIdx !== -1) {
    const path = argv[pathIdx + 1]
    if (!path) throw new Error('--path needs a PostgREST query string')
    console.log(JSON.stringify(await rest(path), null, 2))
    return
  }

  const key = argv[0]
  if (key) {
    const rows = await rest(`algorithm_config?select=key,config&key=eq.${encodeURIComponent(key)}`)
    console.log(JSON.stringify(rows?.[0]?.config ?? null, null, 2))
    return
  }

  const rows = await rest('algorithm_config?select=key,config&order=key')
  for (const row of rows ?? []) {
    console.log(`\n=== ${row.key} ===`)
    console.log(JSON.stringify(row.config, null, 2))
  }
}

main().catch((err) => {
  console.error('[db-read]', err.message)
  process.exit(1)
})
