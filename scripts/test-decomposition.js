/**
 * Test phrase decomposition against database
 *
 * Checks if practice phrases can be decomposed into known LEGOs
 * using greedy longest-match algorithm
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Normalize text for matching (lowercase, trim, normalize spaces)
function normalize(text) {
  return text?.toLowerCase().trim().replace(/\s+/g, ' ') || ''
}

// Greedy decomposition - find longest matching LEGO at each position
function decomposePhrase(phraseText, legoMap, isTarget = true) {
  const normalized = normalize(phraseText)
  const words = normalized.split(' ')
  const result = []
  let i = 0

  while (i < words.length) {
    let longestMatch = null
    let longestLength = 0

    // Try progressively shorter sequences starting at position i
    for (let len = words.length - i; len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoId = legoMap.get(candidate)

      if (legoId) {
        longestMatch = { legoId, text: candidate, wordCount: len }
        longestLength = len
        break // Found longest match
      }
    }

    if (longestMatch) {
      result.push(longestMatch)
      i += longestLength
    } else {
      // No match found - record the unmatched word
      result.push({ legoId: null, text: words[i], wordCount: 1, unmatched: true })
      i++
    }
  }

  return result
}

async function main() {
  console.log('Fetching LEGOs...')

  // Get all LEGOs
  const { data: legos, error: legoError } = await supabase
    .from('course_legos')
    .select('lego_id, known_text, target_text, course_code')
    .limit(5000)

  if (legoError) {
    console.error('Error fetching LEGOs:', legoError)
    return
  }

  console.log(`Found ${legos.length} LEGOs`)

  // Build lookup maps (text → lego_id)
  const knownMap = new Map()
  const targetMap = new Map()

  for (const lego of legos) {
    const knownNorm = normalize(lego.known_text)
    const targetNorm = normalize(lego.target_text)

    // Store by normalized text (may have collisions - last wins)
    if (knownNorm) knownMap.set(knownNorm, lego.lego_id)
    if (targetNorm) targetMap.set(targetNorm, lego.lego_id)
  }

  console.log(`Known text map: ${knownMap.size} entries`)
  console.log(`Target text map: ${targetMap.size} entries`)

  // Get practice phrases
  console.log('\nFetching practice phrases...')

  const { data: phrases, error: phraseError } = await supabase
    .from('course_practice_phrases')
    .select('id, seed_number, lego_index, known_text, target_text, course_code, lego_count')
    .limit(5000)

  if (phraseError) {
    console.error('Error fetching phrases:', phraseError)
    return
  }

  console.log(`Found ${phrases.length} practice phrases`)

  // Test decomposition
  console.log('\n=== DECOMPOSITION TEST ===\n')

  let fullMatches = 0
  let partialMatches = 0
  let failures = []

  for (const phrase of phrases) {
    const targetDecomp = decomposePhrase(phrase.target_text, targetMap, true)
    const knownDecomp = decomposePhrase(phrase.known_text, knownMap, false)

    const targetUnmatched = targetDecomp.filter(d => d.unmatched)
    const knownUnmatched = knownDecomp.filter(d => d.unmatched)

    // Derive LEGO ID from seed_number and lego_index
    const legoId = `S${String(phrase.seed_number).padStart(4,'0')}L${String(phrase.lego_index).padStart(2,'0')}`

    if (targetUnmatched.length === 0 && knownUnmatched.length === 0) {
      fullMatches++
    } else if (targetUnmatched.length === 0 || knownUnmatched.length === 0) {
      partialMatches++
    } else {
      failures.push({
        phraseId: phrase.id,
        legoId,
        legoCount: phrase.lego_count,
        known: phrase.known_text,
        target: phrase.target_text,
        targetUnmatched: targetUnmatched.map(d => d.text),
        knownUnmatched: knownUnmatched.map(d => d.text),
        targetDecomp,
        knownDecomp
      })
    }
  }

  console.log(`Full matches: ${fullMatches} / ${phrases.length} (${(fullMatches/phrases.length*100).toFixed(1)}%)`)
  console.log(`Partial matches: ${partialMatches}`)
  console.log(`Failures: ${failures.length}`)

  if (failures.length > 0) {
    console.log('\n=== SAMPLE FAILURES (first 10) ===\n')

    for (const f of failures.slice(0, 10)) {
      console.log(`Phrase: "${f.target}" / "${f.known}"`)
      console.log(`  LEGO: ${f.legoId} (expects ${f.legoCount} LEGOs)`)
      console.log(`  Target unmatched: ${f.targetUnmatched.join(', ')}`)
      console.log(`  Known unmatched: ${f.knownUnmatched.join(', ')}`)
      console.log(`  Target decomp: ${f.targetDecomp.map(d => d.unmatched ? `[${d.text}]` : d.text).join(' | ')}`)
      console.log(`  Known decomp: ${f.knownDecomp.map(d => d.unmatched ? `[${d.text}]` : d.text).join(' | ')}`)
      console.log('')
    }
  }

  // Show some successful decompositions
  console.log('\n=== SAMPLE SUCCESSFUL DECOMPOSITIONS (first 5) ===\n')

  let shown = 0
  for (const phrase of phrases) {
    if (shown >= 5) break

    const targetDecomp = decomposePhrase(phrase.target_text, targetMap, true)
    const hasUnmatched = targetDecomp.some(d => d.unmatched)

    if (!hasUnmatched && targetDecomp.length > 1) {
      console.log(`"${phrase.target_text}"`)
      console.log(`  → ${targetDecomp.map(d => `[${d.legoId}: ${d.text}]`).join(' + ')}`)
      console.log('')
      shown++
    }
  }
}

main().catch(console.error)
