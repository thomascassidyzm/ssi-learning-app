#!/usr/bin/env node
// definer-grant-standing-check.mjs — the check that would have caught all eight (#317, #324).
//
// WHY THIS EXISTS. Eight prior audits asked "does this SECURITY DEFINER function pin
// search_path?" — a real question, correctly answered in August, and completely orthogonal to
// WHO MAY CALL THIS AND WHOSE DATA DOES IT RETURN. For a SECURITY DEFINER function there is no
// RLS behind it: the GRANT is the authorisation, and Supabase's copy-paste
// `GRANT ALL TO anon, authenticated, service_role` leaves the gate open by default. #317/#324
// found eight of these live: find_learner_by_email (an email oracle), accrue_teacher_commission_
// held + reverse_teacher_commission (money writes), audit_log_prune (an audit-trail delete),
// analytics_learner_progress_rate (a progress reader), activate_brief_version + activate_
// prompt_version (repoint AI course generation), and admin_practice_minutes_by_course (a client-
// supplied uuid[] with no auth.uid() gate — the known residual as of 2026-09-07, being fixed by
// another worker).
//
// THE RULE (mechanical, never reads what the SQL logic actually does):
//   flag any SECURITY DEFINER function in public that is
//     (a) granted EXECUTE to anon or authenticated (PUBLIC counts — it covers both), AND
//     (b) EITHER takes an identifier-shaped parameter (uuid/uuid[], or a text/varchar parameter
//         whose name reads as email/key/token/id) OR performs a write (INSERT/UPDATE/DELETE/
//         MERGE anywhere in its body), AND
//     (c) never mentions auth.uid() or auth.jwt() anywhere in its body.
//
// READS THE LIVE CATALOG ONLY — pg_proc + has_function_privilege against a direct Postgres
// connection, never migration files, since migrations don't reliably reflect what's deployed
// (schema.sql is a dump of a moment, not a live read).
//
// Usage:
//   node tools/definer-grant-standing-check.mjs            # check live DB, exit 1 on new finding
//   node tools/definer-grant-standing-check.mjs --dump path/to/schema.sql   # calibrate offline
//                                                                            # against a prior dump
//   node tools/definer-grant-standing-check.mjs --json     # machine-readable output

import fs from 'node:fs'
import { createRequire } from 'node:module'

const DASHBOARD_REPO = '/home/tomcassidy/ssi-dashboard-v7-clean'
const require = createRequire(DASHBOARD_REPO + '/')
const { Client } = require(DASHBOARD_REPO + '/node_modules/pg')

const ALLOWLIST_PATH = new URL('./definer-grant-standing-allowlist.json', import.meta.url)

const args = process.argv.slice(2)
const dumpPath = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null
const asJson = args.includes('--json')

function loadAllowlist() {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  for (const entry of raw) {
    if (!entry.name || !entry.reason || entry.reason.trim().length < 10) {
      throw new Error(
        `allowlist entry ${JSON.stringify(entry)} needs a real one-line reason, not a bare name`
      )
    }
  }
  return raw
}

// ── identifier-shaped parameter heuristic ───────────────────────────────────
const IDENTIFIER_NAME = /(email|_key$|^key$|token|_id$|^id$)/i

function isIdentifierArg(argType, argName) {
  const t = argType.toLowerCase()
  if (t.includes('uuid')) return true // uuid or uuid[]
  if ((t.includes('text') || t.includes('varchar') || t.includes('char')) && argName) {
    return IDENTIFIER_NAME.test(argName)
  }
  return false
}

const WRITE_RE = /\b(insert|update|delete|merge)\b/i
const AUTH_CHECK_RE = /auth\.(uid|jwt)\s*\(/i

// ── live-catalog path ───────────────────────────────────────────────────────
async function loadDbUrl() {
  const raw = fs.readFileSync(`${DASHBOARD_REPO}/.env.psql`, 'utf8')
  const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)
  if (!m) throw new Error('DATABASE_URL not found in .env.psql')
  return m[1]
}

async function fetchLiveFunctions() {
  const DB = await loadDbUrl()
  const client = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows } = await client.query(`
      select
        p.oid::text as oid,
        p.proname as name,
        pg_get_function_identity_arguments(p.oid) as args_sig,
        (
          select coalesce(json_agg(json_build_object('name', a.argname, 'type', a.argtype_str)), '[]')
          from unnest(
            coalesce(p.proargnames, array[]::text[]),
            array(select format_type(t, null) from unnest(p.proargtypes) as t)
          ) as a(argname, argtype_str)
        ) as args,
        pg_get_functiondef(p.oid) as body,
        (p.prorettype = 'trigger'::regtype) as is_trigger,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef = true
    `)
    return rows.map((r) => ({
      name: r.name,
      argsSig: r.args_sig,
      args: r.args,
      body: r.body,
      isTrigger: r.is_trigger,
      grantedTo: {
        anon: r.anon_exec,
        authenticated: r.authenticated_exec,
        service_role: r.service_role_exec,
      },
    }))
  } finally {
    await client.end()
  }
}

// ── offline calibration path: read a schema.sql-style dump instead of the live DB ──
// schema.sql (pg_dump --schema-only) gives us CREATE FUNCTION bodies and explicit
// GRANT/REVOKE lines. We don't get has_function_privilege, so grants are derived by
// replaying every GRANT/REVOKE line against the function in file order — the same
// thing PostgreSQL's ACL does, just textually.
function matchingParen(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseDumpFunctions(dumpText) {
  const functions = new Map() // name -> { argsSig, body, grantedTo }

  // 1. bodies. pg_dump emits `CREATE FUNCTION public.name(args) ... AS $tag$ ... $tag$;`
  // with the dollar-quote tag varying per function ($$, $_$, ...) and no reliable
  // one-line terminator after it (no ALTER FUNCTION OWNER line in this dump) — so we
  // find the signature, then find ITS OWN dollar-tag, then find that tag's own close.
  const sigRe = /CREATE FUNCTION public\.(\w+)\(/g
  let sig
  while ((sig = sigRe.exec(dumpText))) {
    const name = sig[1]
    const openParenIdx = sig.index + sig[0].length - 1
    const closeParenIdx = matchingParen(dumpText, openParenIdx)
    if (closeParenIdx === -1) continue
    const argsSig = dumpText.slice(openParenIdx + 1, closeParenIdx).trim()

    const sigTail = dumpText.slice(closeParenIdx, closeParenIdx + 400)
    const isTrigger = /\bRETURNS\s+trigger\b/i.test(sigTail)

    const asMatch = /\bAS\s+(\$[a-zA-Z_]*\$)/.exec(dumpText.slice(closeParenIdx))
    if (!asMatch) continue
    const tag = asMatch[1]
    const tagStart = closeParenIdx + asMatch.index + asMatch[0].length
    const tagEnd = dumpText.indexOf(tag, tagStart)
    if (tagEnd === -1) continue
    const bodyEnd = tagEnd + tag.length + 1 // include trailing ';'
    const full = dumpText.slice(sig.index, bodyEnd)

    functions.set(name, {
      argsSig,
      body: full,
      isTrigger,
      grantedTo: { anon: false, authenticated: false, service_role: false, PUBLIC: false },
    })
  }

  // 2. replay GRANT/REVOKE EXECUTE/ALL ... ON FUNCTION public.name(...) ... TO/FROM roles;
  // in file order (dumps are already emitted in a stable, meaningful order).
  const aclLineRe =
    /^(GRANT|REVOKE)\s+(?:EXECUTE|ALL)\s+ON FUNCTION public\.(\w+)\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);$/gm
  let aclMatch
  while ((aclMatch = aclLineRe.exec(dumpText))) {
    const [, verb, name, rolesRaw] = aclMatch
    const fn = functions.get(name)
    if (!fn) continue
    const roles = rolesRaw.split(',').map((r) => r.trim())
    for (const role of roles) {
      const key = role === 'PUBLIC' ? 'PUBLIC' : role
      if (!(key in fn.grantedTo)) continue
      fn.grantedTo[key] = verb === 'GRANT'
    }
  }

  // PUBLIC grant/revoke propagates to anon+authenticated (never to service_role, which
  // is never implicitly covered by PUBLIC in practice here — it always gets its own line).
  for (const fn of functions.values()) {
    if (fn.grantedTo.PUBLIC) {
      fn.grantedTo.anon = true
      fn.grantedTo.authenticated = true
    }
  }

  return [...functions.entries()]
    .filter(([, v]) => /SECURITY DEFINER/.test(v.body))
    .map(([name, v]) => ({
      name,
      argsSig: v.argsSig,
      args: parseArgsSigToArgs(v.argsSig),
      body: v.body,
      isTrigger: v.isTrigger,
      grantedTo: v.grantedTo,
    }))
}

function parseArgsSigToArgs(argsSig) {
  if (!argsSig.trim()) return []
  // naive split on top-level commas — arg lists here don't nest parens in practice
  return argsSig.split(',').map((part) => {
    const trimmed = part.trim()
    const bits = trimmed.split(/\s+/)
    if (bits.length >= 2) {
      return { name: bits[0], type: bits.slice(1).join(' ') }
    }
    return { name: null, type: trimmed }
  })
}

// ── the rule itself ──────────────────────────────────────────────────────────
// Deliberately literal on limb (c): does THIS function's own body mention
// auth.uid()/auth.jwt(), textually, anywhere. No transitive "does it call a
// helper that checks auth" closure — tried that, and it silently cleared
// admin_practice_minutes_by_course, whose is_ssi_admin() call only gates the
// NULL (platform-wide) branch while the explicit-ids branch sails through
// ungated. Control flow is exactly the "read the SQL logic" this check is
// built to avoid — so a helper-gated function surfaces as a finding same as
// any other, and earns its allowlist entry (with a reason) or its fix on its
// own merits, never on the strength of a name it happens to call.
function evaluate(fn) {
  // A function that RETURNS trigger cannot be invoked directly outside trigger
  // context — Postgres itself refuses ("trigger functions can only be called as
  // triggers"). A GRANT EXECUTE on one to anon is inert, not a hole. This is a
  // mechanical exclusion on the return type, never on the function's name.
  if (fn.isTrigger) return null

  const reachableByBrowser = fn.grantedTo.anon || fn.grantedTo.authenticated
  if (!reachableByBrowser) return null

  const hasIdentifierArg = (fn.args || []).some((a) => isIdentifierArg(a.type || '', a.name))
  const performsWrite = WRITE_RE.test(fn.body || '')
  if (!hasIdentifierArg && !performsWrite) return null

  const hasAuthCheck = AUTH_CHECK_RE.test(fn.body || '')
  if (hasAuthCheck) return null

  const trippedLimbs = []
  if (hasIdentifierArg) trippedLimbs.push('identifier-arg')
  if (performsWrite) trippedLimbs.push('write')

  const roles = Object.entries(fn.grantedTo)
    .filter(([, v]) => v)
    .map(([k]) => k)

  return {
    name: fn.name,
    args: fn.argsSig,
    grantedTo: roles,
    trippedLimbs,
  }
}

function runCheck(functions, allowlist) {
  const allowedNames = new Set(allowlist.map((e) => e.name))
  const findings = functions.map(evaluate).filter(Boolean)
  const unallowlisted = findings.filter((f) => !allowedNames.has(f.name))
  const allowlisted = findings.filter((f) => allowedNames.has(f.name))
  return { findings, unallowlisted, allowlisted }
}

function printReport({ findings, unallowlisted, allowlisted }, allowlist) {
  if (findings.length === 0) {
    console.log('definer-grant-standing-check: no SECURITY DEFINER function trips the rule.')
    return
  }
  console.log(
    `definer-grant-standing-check: ${findings.length} function(s) trip the rule ` +
      `(${unallowlisted.length} NOT allowlisted, ${allowlisted.length} allowlisted).\n`
  )
  for (const f of findings) {
    const isAllowed = allowedNames_has(allowlist, f.name)
    const tag = isAllowed ? '[allowlisted]' : '[UNALLOWLISTED]'
    console.log(
      `${tag} ${f.name}(${f.args})  granted-to=[${f.grantedTo.join(', ')}]  tripped=[${f.trippedLimbs.join(', ')}]`
    )
    if (isAllowed) {
      const entry = allowlist.find((e) => e.name === f.name)
      console.log(`    reason: ${entry.reason}`)
    }
  }
}

function allowedNames_has(allowlist, name) {
  return allowlist.some((e) => e.name === name)
}

async function main() {
  const allowlist = loadAllowlist()
  const functions = dumpPath
    ? parseDumpFunctions(fs.readFileSync(dumpPath, 'utf8'))
    : await fetchLiveFunctions()

  const result = runCheck(functions, allowlist)

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printReport(result, allowlist)
  }

  if (result.unallowlisted.length > 0) {
    process.exitCode = 1
  }
}

// Only run as a script when invoked directly (`node tools/definer-grant-standing-check.mjs`);
// importing this module from a test must not hit the network or exit the process.
const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href
if (isMain) {
  main().catch((err) => {
    console.error('definer-grant-standing-check: FAILED TO RUN —', err.message)
    process.exitCode = 2
  })
}

export { parseDumpFunctions, evaluate, runCheck, isIdentifierArg }
