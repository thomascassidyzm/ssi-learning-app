#!/usr/bin/env node
/**
 * analyze-use-phrase-decomposition.mjs
 *
 * Read-only analysis. Samples N USE phrases at random for a given course
 * and checks how decomposable they are against the course's full LEGO
 * vocab map using the same greedy max-munch algorithm the client uses
 * at render time (decomposePhrase.ts).
 *
 * Per methodology, every word in a USE phrase MUST be a previously-
 * introduced LEGO — so any unmatched token surfaces a content
 * authoring gap (canonical-form mismatch, missing LEGO, inflection,
 * punctuation drift, etc.).
 *
 * Usage:
 *   node scripts/analyze-use-phrase-decomposition.mjs <course_code> [sample_size]
 *
 * Examples:
 *   node scripts/analyze-use-phrase-decomposition.mjs deu_for_eng
 *   node scripts/analyze-use-phrase-decomposition.mjs deu_for_eng 100
 *
 * Output: console summary + JSON report written to
 *   ~/Desktop/ssi-use-phrase-decomposition-<course>-<timestamp>.json
 *
 * NOTE: read-only. Pulls from course_legos + course_practice_phrases.
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

/** Greedy max-munch decomposition. Mirrors decomposePhrase.ts client-side
 *  algorithm: at each position, try the longest matching window down to 1
 *  token. Multi-word M-LEGOs bind as one unit before falling back to
 *  individual A-LEGOs. */
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
        result.push({ legoId, text: key, wordCount: w, unmatched: false })
        pos += w
        matched = true
        break
      }
    }
    if (!matched) {
      result.push({ legoId: null, text: tokens[pos], wordCount: 1, unmatched: true })
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

async function main() {
  const courseCode = process.argv[2]
  const sampleSize = parseInt(process.argv[3] || '50', 10)

  if (!courseCode) {
    console.error('Usage: node scripts/analyze-use-phrase-decomposition.mjs <course_code> [sample_size]')
    console.error('Example: node scripts/analyze-use-phrase-decomposition.mjs deu_for_eng 50')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  console.log(`\nCourse: ${courseCode}`)
  console.log(`Sample size: ${sampleSize}`)
  console.log('')

  // 1. Pull every LEGO for the course (A-LEGOs and M-LEGOs both live in
  //    course_legos with their canonical target_text). Then pull every
  //    M-LEGO component atom (course_practice_phrases where
  //    phrase_role='component'). Merge into one vocab map keyed by
  //    normalised text. LEGOs win on conflict — if "ich" exists as both
  //    an A-LEGO and as a component, the A-LEGO id is what we surface.
  console.log('Fetching LEGOs...')
  const { data: legos, error: legoErr } = await supabase
    .from('course_legos')
    .select('lego_id, target_text')
    .eq('course_code', courseCode)
    .limit(20000)
  if (legoErr) { console.error('LEGO query failed:', legoErr); process.exit(1) }
  console.log(`  ${legos.length} LEGOs`)

  console.log('Fetching component atoms...')
  const { data: components, error: compErr } = await supabase
    .from('course_practice_phrases')
    .select('seed_number, lego_index, target_text')
    .eq('course_code', courseCode)
    .eq('phrase_role', 'component')
    .limit(20000)
  if (compErr) { console.error('Component query failed:', compErr); process.exit(1) }
  console.log(`  ${components.length} component atoms`)

  // Vocab map: normalised text → { id, source }
  const vocabMap = new Map()
  let legoEntries = 0
  let componentEntries = 0

  // First pass: LEGOs (preferred id source).
  for (const l of legos) {
    if (!l.target_text) continue
    const k = normalise(l.target_text)
    if (!k) continue
    if (!vocabMap.has(k)) {
      vocabMap.set(k, { id: l.lego_id, source: 'lego' })
      legoEntries++
    }
  }

  // Second pass: components. Only add if not already present from a LEGO.
  // Component id format: atom:<parentLegoId> (we know the parent via
  // seed_number + lego_index — same format the rest of the app uses).
  for (const c of components) {
    if (!c.target_text) continue
    const k = normalise(c.target_text)
    if (!k) continue
    if (vocabMap.has(k)) continue
    const parentLego = `S${String(c.seed_number).padStart(4, '0')}L${String(c.lego_index).padStart(2, '0')}`
    vocabMap.set(k, { id: `atom:${parentLego}`, source: 'component' })
    componentEntries++
  }

  console.log(`  vocab map: ${vocabMap.size} unique entries (${legoEntries} from LEGOs, ${componentEntries} from components)`)
  console.log('')

  // The decomposer needs `text → id`; keep that shape for compatibility.
  const targetMap = new Map([...vocabMap.entries()].map(([k, v]) => [k, v.id]))

  // 2. Pull all USE-style phrases (phrase_role IN ('practice', 'eternal_eligible')).
  // Exclude 'component' rows — those are M-LEGO atoms, not USE phrases.
  console.log('Fetching USE phrases...')
  const { data: phrases, error: phraseErr } = await supabase
    .from('course_practice_phrases')
    .select('id, seed_number, lego_index, target_text, phrase_role, lego_count')
    .eq('course_code', courseCode)
    .eq('phrase_role', 'use')
    .limit(20000)
  if (phraseErr) { console.error('Phrase query failed:', phraseErr); process.exit(1) }
  console.log(`  ${phrases.length} USE phrases total`)
  console.log('')

  if (phrases.length === 0) {
    console.log('No phrases to analyse. Done.')
    return
  }

  // 3. Random sample.
  const sample = shuffle(phrases).slice(0, Math.min(sampleSize, phrases.length))

  // 4. Decompose each phrase, bucket the results.
  const fullyMatched = []
  const partiallyMatched = []
  const noneMatched = []
  const allUnmatchedTokens = new Map() // token → count

  for (const p of sample) {
    const phraseText = p.target_text || ''
    if (!phraseText) continue
    const decomp = decompose(phraseText, targetMap)
    const unmatched = decomp.filter(d => d.unmatched)
    const matched = decomp.filter(d => !d.unmatched)
    const entry = {
      phraseId: p.id,
      sourceLegoId: `S${String(p.seed_number).padStart(4, '0')}L${String(p.lego_index).padStart(2, '0')}`,
      role: p.phrase_role,
      phrase: phraseText,
      tokenCount: decomp.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      unmatchedTokens: unmatched.map(d => d.text),
      decomposition: decomp.map(d =>
        d.unmatched ? `[${d.text}]` : `{${d.legoId}: ${d.text}}`,
      ).join(' · '),
    }
    if (unmatched.length === 0) fullyMatched.push(entry)
    else if (matched.length === 0) noneMatched.push(entry)
    else partiallyMatched.push(entry)
    for (const u of unmatched) {
      allUnmatchedTokens.set(u.text, (allUnmatchedTokens.get(u.text) || 0) + 1)
    }
  }

  // 5. Print summary.
  const total = sample.length
  console.log('=== Decomposition coverage ===')
  console.log(`Fully matched:      ${fullyMatched.length} / ${total}  (${(fullyMatched.length / total * 100).toFixed(1)}%)`)
  console.log(`Partially matched:  ${partiallyMatched.length} / ${total}  (${(partiallyMatched.length / total * 100).toFixed(1)}%)`)
  console.log(`Nothing matched:    ${noneMatched.length} / ${total}  (${(noneMatched.length / total * 100).toFixed(1)}%)`)
  console.log('')

  if (partiallyMatched.length > 0 || noneMatched.length > 0) {
    console.log('=== Most common unmatched tokens ===')
    const topUnmatched = [...allUnmatchedTokens.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
    for (const [tok, n] of topUnmatched) console.log(`  ${n.toString().padStart(3)}  ${tok}`)
    console.log('')

    const sampleOfFailures = [...partiallyMatched, ...noneMatched].slice(0, 10)
    console.log('=== Sample failures (first 10) ===')
    for (const e of sampleOfFailures) {
      console.log(`\n[${e.sourceLegoId} · ${e.role}]`)
      console.log(`  phrase: ${e.phrase}`)
      console.log(`  unmatched (${e.unmatchedCount}/${e.tokenCount}): ${e.unmatchedTokens.join(', ')}`)
      console.log(`  decomp:  ${e.decomposition}`)
    }
    console.log('')
  }

  // 6. Write full JSON report to Desktop.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = join(homedir(), 'Desktop', `ssi-use-phrase-decomposition-${courseCode}-${stamp}.json`)
  const report = {
    course: courseCode,
    sampleSize: total,
    populationSize: phrases.length,
    legoVocab: { targetMapSize: targetMap.size },
    summary: {
      fullyMatched: fullyMatched.length,
      partiallyMatched: partiallyMatched.length,
      noneMatched: noneMatched.length,
    },
    topUnmatched: [...allUnmatchedTokens.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tok, n]) => ({ token: tok, count: n })),
    fullyMatched,
    partiallyMatched,
    noneMatched,
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`Full report written to: ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
