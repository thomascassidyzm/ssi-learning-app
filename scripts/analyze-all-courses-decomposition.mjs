#!/usr/bin/env node
/**
 * analyze-all-courses-decomposition.mjs
 *
 * Read-only. Runs USE-phrase decomposition coverage across every course
 * (course_code) in the database, reporting both the strict and broader
 * methodology interpretations:
 *
 *   strict   = USE phrase fully decomposes into known LEGO target_texts
 *              (course_legos.target_text only)
 *   broader  = USE phrase fully decomposes into LEGO target_texts OR
 *              M-LEGO component atoms (course_practice_phrases where
 *              phrase_role='component')
 *
 * Inflected forms (canonical doesn't match phrase form, e.g. "hat" vs
 * "haben") are NOT given any allowance — per methodology, those are
 * content authoring bugs introduced by agent hallucination.
 *
 * CJK target scripts skipped — whitespace tokeniser doesn't apply.
 * Welsh-style mutations / phonetically-close variants out of scope here
 * (a separate follow-up if Tom wants tiered "near-match" reporting).
 *
 * Usage:
 *   node scripts/analyze-all-courses-decomposition.mjs [sample_size]
 *
 * Output:
 *   - Sorted summary table on stdout (strict % and broader %)
 *   - JSON report at ~/Desktop/ssi-all-courses-decomposition-<timestamp>.json
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

// Mirrors decomposePhrase.ts: preserve in-word apostrophes/hyphens so
// contractions retain identity. Smart-quote variants normalise to ASCII.
const PUNCT_RE = /[.,!?;:¡¿"“”„«»]+/g
const SMART_APOS_RE = /[‘’ʼ]/g
const CJK_RE = /[　-鿿가-힯＀-￯]/
const MIN_LEGOS = 400  // skip partial/template courses below this

function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(SMART_APOS_RE, "'")
    .replace(PUNCT_RE, '')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokenise(text) {
  return normalise(text).split(' ').filter(Boolean)
}

function decompose(phraseText, textToLegoId) {
  const tokens = tokenise(phraseText)
  const result = []
  let pos = 0
  while (pos < tokens.length) {
    let matched = false
    for (let w = tokens.length - pos; w >= 1; w--) {
      const key = tokens.slice(pos, pos + w).join(' ')
      const legoId = textToLegoId.get(key)
      if (legoId) {
        result.push({ legoId, text: key, unmatched: false })
        pos += w
        matched = true
        break
      }
    }
    if (!matched) {
      result.push({ legoId: null, text: tokens[pos], unmatched: true })
      pos += 1
    }
  }
  return result
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function listCourses(supabase) {
  // Distinct course_codes from course_legos. Cheaper than a count(*)
  // per row and gives us the LEGO count per course for the filter.
  const codeCounts = new Map()
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('course_legos')
      .select('course_code')
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data.length) break
    for (const r of data) codeCounts.set(r.course_code, (codeCounts.get(r.course_code) || 0) + 1)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return [...codeCounts.entries()].sort()
}

async function analyseCourse(supabase, courseCode, sampleSize) {
  // Pull legos
  const { data: legos } = await supabase
    .from('course_legos')
    .select('lego_id, target_text')
    .eq('course_code', courseCode)
    .limit(20000)
  if (!legos) return null

  // Pull components
  const { data: components } = await supabase
    .from('course_practice_phrases')
    .select('seed_number, lego_index, target_text')
    .eq('course_code', courseCode)
    .eq('phrase_role', 'component')
    .limit(20000)
  if (!components) return null

  // Pull USE phrases
  const { data: phrases } = await supabase
    .from('course_practice_phrases')
    .select('seed_number, lego_index, target_text')
    .eq('course_code', courseCode)
    .eq('phrase_role', 'use')
    .limit(20000)
  if (!phrases || phrases.length === 0) return null

  // CJK check — bail with a marker
  const sampleText = (legos[0]?.target_text || phrases[0]?.target_text || '')
  if (CJK_RE.test(sampleText)) {
    return { courseCode, skipped: 'cjk', legoCount: legos.length, phraseCount: phrases.length }
  }

  // Build strict map (LEGOs only)
  const strictMap = new Map()
  for (const l of legos) {
    if (!l.target_text) continue
    const k = normalise(l.target_text)
    if (k && !strictMap.has(k)) strictMap.set(k, l.lego_id)
  }

  // Build broader map (LEGOs + components)
  const broaderMap = new Map(strictMap)
  for (const c of components) {
    if (!c.target_text) continue
    const k = normalise(c.target_text)
    if (k && !broaderMap.has(k)) {
      const parent = `S${String(c.seed_number).padStart(4, '0')}L${String(c.lego_index).padStart(2, '0')}`
      broaderMap.set(k, `atom:${parent}`)
    }
  }

  // Sample
  const sample = shuffle(phrases).slice(0, Math.min(sampleSize, phrases.length))

  // Run both maps
  let strictFull = 0
  let broaderFull = 0
  const unmatchedTokens = new Map()
  for (const p of sample) {
    if (!p.target_text) continue
    const strictDecomp = decompose(p.target_text, strictMap)
    const broaderDecomp = decompose(p.target_text, broaderMap)
    if (strictDecomp.every(d => !d.unmatched)) strictFull++
    if (broaderDecomp.every(d => !d.unmatched)) broaderFull++
    for (const d of broaderDecomp) {
      if (d.unmatched) unmatchedTokens.set(d.text, (unmatchedTokens.get(d.text) || 0) + 1)
    }
  }

  const top = [...unmatchedTokens.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tok, n]) => `${tok}(${n})`)

  return {
    courseCode,
    legoCount: legos.length,
    componentCount: components.length,
    phraseCount: phrases.length,
    sampled: sample.length,
    strictFull,
    broaderFull,
    strictPct: sample.length > 0 ? strictFull / sample.length : 0,
    broaderPct: sample.length > 0 ? broaderFull / sample.length : 0,
    topUnmatchedBroader: top,
  }
}

async function main() {
  const sampleSize = parseInt(process.argv[2] || '50', 10)
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  console.log(`\nListing courses (min ${MIN_LEGOS} LEGOs)...`)
  const courses = await listCourses(supabase)
  const eligible = courses.filter(([, n]) => n >= MIN_LEGOS)
  console.log(`  ${courses.length} total course_codes, ${eligible.length} above ${MIN_LEGOS}-LEGO threshold\n`)

  const results = []
  for (const [code, legoCount] of eligible) {
    process.stdout.write(`  ${code.padEnd(20)} `)
    try {
      const r = await analyseCourse(supabase, code, sampleSize)
      if (!r) { console.log('skipped (no data)'); continue }
      if (r.skipped) { console.log(`skipped (${r.skipped})`); results.push(r); continue }
      console.log(
        `strict ${(r.strictPct * 100).toFixed(0).padStart(3)}%  ` +
        `broader ${(r.broaderPct * 100).toFixed(0).padStart(3)}%  ` +
        `(${r.legoCount} legos, ${r.componentCount} comps, ${r.phraseCount} use)`,
      )
      results.push(r)
    } catch (err) {
      console.log(`ERROR: ${err.message || err}`)
    }
  }

  // Summary table sorted by broader % desc
  const ranked = results
    .filter(r => !r.skipped)
    .sort((a, b) => b.broaderPct - a.broaderPct)

  console.log('\n=== Ranked by broader-match % (LEGO + component) ===\n')
  console.log('  course               strict    broader   top unmatched')
  console.log('  ' + '-'.repeat(78))
  for (const r of ranked) {
    const strictStr = `${(r.strictPct * 100).toFixed(0).padStart(3)}%`
    const broaderStr = `${(r.broaderPct * 100).toFixed(0).padStart(3)}%`
    console.log(`  ${r.courseCode.padEnd(20)} ${strictStr.padStart(6)}    ${broaderStr.padStart(6)}    ${r.topUnmatchedBroader.slice(0, 5).join(' ')}`)
  }

  const skipped = results.filter(r => r.skipped)
  if (skipped.length > 0) {
    console.log(`\nSkipped: ${skipped.map(s => `${s.courseCode}(${s.skipped})`).join(', ')}`)
  }

  // JSON dump
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = join(homedir(), 'Desktop', `ssi-all-courses-decomposition-${stamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    sampleSize,
    timestamp: new Date().toISOString(),
    minLegos: MIN_LEGOS,
    results,
  }, null, 2))
  console.log(`\nFull report: ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
