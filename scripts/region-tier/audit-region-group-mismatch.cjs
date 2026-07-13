#!/usr/bin/env node
/**
 * Read-only audit (region-tier design §2 step 2): find any `schools` or
 * `govt_admins` row where BOTH `region_code` and `group_id` are set but they
 * disagree — i.e. the group's name doesn't match the region_code's name in
 * `regions`. Those rows are the ones `schoolScope.ts`'s group-preferred /
 * region-fallback dual-read would resolve differently depending on which
 * column it reads, and must be reconciled before dropping the fallback
 * (design §2 step 4).
 *
 * Never writes. Run after the backfill to confirm zero rows resolve via the
 * legacy fallback path.
 *
 * Usage: node scripts/region-tier/audit-region-group-mismatch.cjs
 */
const path = require('path')
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')

function loadEnv() {
  const fromProcess = {
    url: (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim(),
    key: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  }
  if (fromProcess.url && fromProcess.key) return fromProcess

  const envPath = process.env.PLAYER_VUE_ENV_PATH ||
    path.join(__dirname, '..', '..', 'packages', 'player-vue', '.env')
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in env and no .env at ${envPath}`
    )
  }
  const parsed = {}
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...val] = line.split('=')
    if (key && val.length) parsed[key.trim()] = val.join('=').trim()
  })
  return {
    url: (parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '').trim(),
    key: (parsed.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  }
}

async function auditTable(supabase, table, idCol = 'id') {
  const { data: rows, error } = await supabase
    .from(table)
    .select(`${idCol}, region_code, group_id`)
    .not('region_code', 'is', null)
    .not('group_id', 'is', null)
  if (error) throw new Error(`${table} read failed: ${error.message}`)
  if (!rows.length) return []

  const regionCodes = [...new Set(rows.map((r) => r.region_code))]
  const groupIds = [...new Set(rows.map((r) => r.group_id))]

  const { data: regions } = await supabase.from('regions').select('code, name').in('code', regionCodes)
  const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds)
  const regionNameByCode = new Map((regions || []).map((r) => [r.code, r.name]))
  const groupNameById = new Map((groups || []).map((g) => [g.id, g.name]))

  const mismatches = []
  for (const row of rows) {
    const regionName = regionNameByCode.get(row.region_code)
    const groupName = groupNameById.get(row.group_id)
    if (!regionName || !groupName) continue // unresolvable either side — not a mismatch we can prove
    if (regionName.trim().toLowerCase() !== groupName.trim().toLowerCase()) {
      mismatches.push({ table, id: row[idCol], region_code: row.region_code, regionName, group_id: row.group_id, groupName })
    }
  }
  return mismatches
}

async function main() {
  const { url, key } = loadEnv()
  if (!url || !key) throw new Error('Could not resolve Supabase URL/service key')
  const supabase = createClient(url, key)

  const schoolMismatches = await auditTable(supabase, 'schools')
  const govtMismatches = await auditTable(supabase, 'govt_admins')
  const all = [...schoolMismatches, ...govtMismatches]

  console.log(`Checked schools + govt_admins with both region_code and group_id set.`)
  console.log(`Mismatches found: ${all.length}`)
  if (all.length) {
    console.table(all)
    process.exitCode = 1
  } else {
    console.log('Clean — region_code and group_id agree everywhere they are both set.')
  }
}

main().catch((err) => {
  console.error('AUDIT FAILED:', err.message)
  process.exitCode = 1
})
