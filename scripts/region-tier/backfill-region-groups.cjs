#!/usr/bin/env node
/**
 * region_code -> group_id backfill (region-tier design §2, steps 1-3).
 *
 * For each distinct `region_code` found on `schools` or `govt_admins` with no
 * `group_id` yet, ensure a `groups` row exists (type:'region', name from the
 * `regions` table when known, else the raw region_code) and set `group_id`
 * on every matching row. Idempotent: re-running finds zero groupless rows
 * left and does nothing.
 *
 * DRY RUN by default — prints what it would do, writes nothing. Pass
 * --commit to actually write.
 *
 * Credentials: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment,
 * or PLAYER_VUE_ENV_PATH pointing at a .env file with those keys (defaults to
 * packages/player-vue/.env relative to the repo root).
 *
 * Usage:
 *   node scripts/region-tier/backfill-region-groups.cjs            # dry run
 *   node scripts/region-tier/backfill-region-groups.cjs --commit   # apply
 */
const path = require('path')
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')

const COMMIT = process.argv.includes('--commit')

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

async function main() {
  const { url, key } = loadEnv()
  if (!url || !key) throw new Error('Could not resolve Supabase URL/service key')
  const supabase = createClient(url, key)

  console.log(COMMIT ? '=== APPLYING (--commit) ===' : '=== DRY RUN (pass --commit to apply) ===')

  // 1. Distinct region_codes with groupless rows.
  const { data: schoolRows, error: schoolErr } = await supabase
    .from('schools')
    .select('id, region_code')
    .is('group_id', null)
    .not('region_code', 'is', null)
  if (schoolErr) throw new Error(`schools read failed: ${schoolErr.message}`)

  const { data: govtRows, error: govtErr } = await supabase
    .from('govt_admins')
    .select('id, region_code')
    .is('group_id', null)
    .not('region_code', 'is', null)
  if (govtErr) throw new Error(`govt_admins read failed: ${govtErr.message}`)

  const distinctRegionCodes = [...new Set([
    ...schoolRows.map((r) => r.region_code),
    ...govtRows.map((r) => r.region_code),
  ])].filter(Boolean)

  console.log(`Groupless schools: ${schoolRows.length}, groupless govt_admins: ${govtRows.length}`)
  console.log(`Distinct region_codes needing a group: ${distinctRegionCodes.length}`, distinctRegionCodes)

  if (distinctRegionCodes.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  // 2. Resolve names from `regions`, fall back to the raw code.
  const { data: regionRows } = await supabase
    .from('regions')
    .select('code, name')
    .in('code', distinctRegionCodes)
  const nameByCode = new Map((regionRows || []).map((r) => [r.code, r.name]))

  // 3. For each region_code, reuse an existing group with a matching name
  //    (idempotency across re-runs / manually pre-built groups), else create.
  const groupIdByCode = new Map()
  for (const code of distinctRegionCodes) {
    const name = nameByCode.get(code) || code
    const { data: existingGroup, error: existErr } = await supabase
      .from('groups')
      .select('id, name')
      .ilike('name', name)
      .eq('type', 'region')
      .maybeSingle()
    if (existErr) throw new Error(`groups lookup failed for "${name}": ${existErr.message}`)

    if (existingGroup) {
      console.log(`  region_code=${code} -> reusing existing group "${existingGroup.name}" (${existingGroup.id})`)
      groupIdByCode.set(code, existingGroup.id)
      continue
    }

    if (!COMMIT) {
      console.log(`  region_code=${code} -> WOULD CREATE group "${name}"`)
      continue
    }

    const { data: newGroup, error: createErr } = await supabase
      .from('groups')
      .insert({ name, type: 'region' })
      .select('id, name')
      .single()
    if (createErr || !newGroup) {
      throw new Error(`group create failed for "${name}": ${createErr?.message}`)
    }
    console.log(`  region_code=${code} -> created group "${newGroup.name}" (${newGroup.id})`)
    groupIdByCode.set(code, newGroup.id)
  }

  if (!COMMIT) {
    console.log('\nDry run complete — no writes made. Re-run with --commit to apply.')
    return
  }

  // 4. Set group_id on every matching row.
  let schoolsUpdated = 0
  let govtUpdated = 0
  for (const [code, groupId] of groupIdByCode.entries()) {
    const { data: updatedSchools, error: sErr } = await supabase
      .from('schools')
      .update({ group_id: groupId })
      .eq('region_code', code)
      .is('group_id', null)
      .select('id')
    if (sErr) throw new Error(`schools update failed for ${code}: ${sErr.message}`)
    schoolsUpdated += (updatedSchools || []).length

    const { data: updatedGovt, error: gErr } = await supabase
      .from('govt_admins')
      .update({ group_id: groupId })
      .eq('region_code', code)
      .is('group_id', null)
      .select('id')
    if (gErr) throw new Error(`govt_admins update failed for ${code}: ${gErr.message}`)
    govtUpdated += (updatedGovt || []).length
  }

  console.log(`\nBackfill applied: ${schoolsUpdated} schools, ${govtUpdated} govt_admins updated.`)
}

main().catch((err) => {
  console.error('BACKFILL FAILED:', err.message)
  process.exitCode = 1
})
