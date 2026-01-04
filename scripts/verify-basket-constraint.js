/**
 * Verify LEGO Basket Constraint
 *
 * For each practice phrase associated with LEGO N, verify that
 * the phrase only uses LEGOs from positions 1 through N.
 *
 * The basket constraint ensures sequential learning:
 * - Learner can only practice with vocabulary they've already learned
 * - Phrase for LEGO N should NOT contain vocabulary from LEGO N+1 or later
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Normalize text for matching
function normalize(text) {
  return text?.toLowerCase().trim().replace(/\s+/g, ' ') || ''
}

// Convert LEGO ID to a linear position for comparison
// S0001L01 = 1, S0001L02 = 2, S0002L01 = 3 (assuming avg 2 LEGOs per seed)
function legoIdToPosition(legoId) {
  const match = legoId.match(/S(\d+)L(\d+)/)
  if (!match) return Infinity
  const seedNum = parseInt(match[1], 10)
  const legoIndex = parseInt(match[2], 10)
  // Combine: seed gives major position, lego_index gives minor
  return seedNum * 100 + legoIndex
}

// Greedy decomposition - find longest matching LEGO at each position
function decomposePhrase(phraseText, legoMap) {
  const normalized = normalize(phraseText)
  const words = normalized.split(' ')
  const result = []
  let i = 0

  while (i < words.length) {
    let longestMatch = null
    let longestLength = 0

    for (let len = words.length - i; len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoId = legoMap.get(candidate)

      if (legoId) {
        longestMatch = { legoId, text: candidate, wordCount: len }
        longestLength = len
        break
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
  const courseCode = process.argv[2] || 'cym-ssi-v1' // Default to Welsh course

  console.log(`\n=== BASKET CONSTRAINT VERIFICATION ===`)
  console.log(`Course: ${courseCode}\n`)

  // Get all LEGOs in order
  console.log('Fetching LEGOs...')
  const { data: legos, error: legoError } = await supabase
    .from('course_legos')
    .select('lego_id, seed_number, lego_index, target_text, known_text')
    .eq('course_code', courseCode)
    .order('seed_number')
    .order('lego_index')

  if (legoError) {
    console.error('Error fetching LEGOs:', legoError)
    return
  }

  console.log(`Found ${legos.length} LEGOs`)

  // Build lookup maps
  const targetMap = new Map() // normalized target text → lego_id
  const legoPositions = new Map() // lego_id → linear position (for ordering)

  for (let i = 0; i < legos.length; i++) {
    const lego = legos[i]
    const targetNorm = normalize(lego.target_text)
    if (targetNorm) {
      targetMap.set(targetNorm, lego.lego_id)
    }
    // Linear position (0-based index in the ordered list)
    legoPositions.set(lego.lego_id, i + 1)
  }

  console.log(`Target text map: ${targetMap.size} entries`)

  // Get practice phrases (paginate for large courses)
  console.log('\nFetching practice phrases...')
  let allPhrases = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data: page, error: phraseError } = await supabase
      .from('course_practice_phrases')
      .select('id, seed_number, lego_index, target_text, known_text, position')
      .eq('course_code', courseCode)
      .gt('position', 1) // Only practice phrases, not components or debut
      .order('seed_number')
      .order('lego_index')
      .order('position')
      .range(offset, offset + pageSize - 1)

    if (phraseError) {
      console.error('Error fetching phrases:', phraseError)
      return
    }

    if (!page || page.length === 0) break
    allPhrases = allPhrases.concat(page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  console.log(`Found ${allPhrases.length} practice phrases`)

  // Analyze basket constraint violations
  console.log('\n=== ANALYZING BASKET CONSTRAINT ===\n')

  let totalPhrases = 0
  let validPhrases = 0
  let violations = []
  let unmatchedPhrases = 0

  for (const phrase of allPhrases) {
    totalPhrases++

    // Get the LEGO this phrase belongs to
    const phraseLegoId = `S${String(phrase.seed_number).padStart(4,'0')}L${String(phrase.lego_index).padStart(2,'0')}`
    const phraseLegoPosition = legoPositions.get(phraseLegoId)

    if (!phraseLegoPosition) {
      // Phrase belongs to unknown LEGO (shouldn't happen)
      console.warn(`Phrase belongs to unknown LEGO: ${phraseLegoId}`)
      continue
    }

    // Decompose the phrase
    const decomp = decomposePhrase(phrase.target_text, targetMap)
    const hasUnmatched = decomp.some(d => d.unmatched)

    if (hasUnmatched) {
      unmatchedPhrases++
      continue // Can't verify if we can't decompose
    }

    // Check if all LEGOs in the phrase are at or before the current position
    let isValid = true
    let futureLegoIds = []

    for (const part of decomp) {
      if (!part.legoId) continue

      const partPosition = legoPositions.get(part.legoId)
      if (partPosition > phraseLegoPosition) {
        isValid = false
        futureLegoIds.push({
          legoId: part.legoId,
          text: part.text,
          position: partPosition
        })
      }
    }

    if (isValid) {
      validPhrases++
    } else {
      violations.push({
        phraseLegoId,
        phraseLegoPosition,
        phraseText: phrase.target_text,
        decomposition: decomp.map(d => ({ legoId: d.legoId, text: d.text })),
        futureLegoIds
      })
    }
  }

  // Report results
  console.log(`RESULTS:`)
  console.log(`  Total practice phrases: ${totalPhrases}`)
  console.log(`  Valid (basket constraint OK): ${validPhrases}`)
  console.log(`  Violations (uses future vocab): ${violations.length}`)
  console.log(`  Unmatched (couldn't decompose): ${unmatchedPhrases}`)

  if (violations.length > 0) {
    console.log(`\n=== SAMPLE VIOLATIONS (first 20) ===\n`)

    for (const v of violations.slice(0, 20)) {
      console.log(`LEGO ${v.phraseLegoId} (position ${v.phraseLegoPosition}):`)
      console.log(`  Phrase: "${v.phraseText}"`)
      console.log(`  Decomposition: ${v.decomposition.map(d => d.legoId || `[${d.text}]`).join(' → ')}`)
      console.log(`  ⚠️ Uses FUTURE vocabulary:`)
      for (const f of v.futureLegoIds) {
        console.log(`     - ${f.legoId} "${f.text}" (position ${f.position})`)
      }
      console.log('')
    }

    // Summary of violation patterns
    console.log(`\n=== VIOLATION SUMMARY ===\n`)

    // Group by how far ahead the future vocab is
    const gapCounts = new Map()
    for (const v of violations) {
      for (const f of v.futureLegoIds) {
        const gap = f.position - v.phraseLegoPosition
        gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1)
      }
    }

    console.log('Gap distribution (how many LEGOs ahead):')
    const sortedGaps = [...gapCounts.entries()].sort((a, b) => a[0] - b[0])
    for (const [gap, count] of sortedGaps.slice(0, 10)) {
      console.log(`  +${gap} LEGOs ahead: ${count} occurrences`)
    }
  } else {
    console.log('\n✅ All phrases satisfy the basket constraint!')
  }
}

main().catch(console.error)
