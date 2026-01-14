/**
 * Course Gate Validation Script
 *
 * Validates a course against quality gates:
 * - REJECT if phrase uses vocab not already introduced (LEGOs or M-type components)
 * - REJECT if <7 phrases (after first 5 seeds)
 * - FLAG if <10 phrases
 * - FLAG if no long phrases (10+ syllables)
 *
 * Usage: node scripts/validate-course-gates.mjs [course_code]
 * Default: por_for_eng
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const COURSE_CODE = process.argv[2] || 'por_for_eng'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function normalize(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿¡.,;:!?'"«»""'']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

function countSyllables(text) {
  const words = text.toLowerCase().split(/\s+/)
  let total = 0
  for (const word of words) {
    // Portuguese/Spanish syllable counting (vowel groups)
    const vowelGroups = word.match(/[aeiouáéíóúâêôãõàü]+/gi) || []
    total += Math.max(1, vowelGroups.length)
  }
  return total
}

async function main() {
  console.log(`\nValidating course: ${COURSE_CODE}\n`)

  // Load all LEGOs
  const { data: legos, error: legoErr } = await supabase
    .from('course_legos')
    .select('*')
    .eq('course_code', COURSE_CODE)
    .order('seed_number')
    .order('lego_index')

  if (legoErr) {
    console.error('Error loading LEGOs:', legoErr)
    return
  }

  // Load all phrases
  const { data: phrases, error: phraseErr } = await supabase
    .from('course_practice_phrases')
    .select('*')
    .eq('course_code', COURSE_CODE)

  if (phraseErr) {
    console.error('Error loading phrases:', phraseErr)
    return
  }

  console.log(`Loaded ${legos.length} LEGOs and ${phrases.length} phrases\n`)

  // Build vocabulary set (cumulative as we process LEGOs in order)
  const vocabSet = new Set()
  const results = { passed: [], rejected: [], flagged: [] }

  for (const lego of legos) {
    const legoKey = `S${String(lego.seed_number).padStart(2, '0')}L${lego.lego_index}`
    const issues = []
    const warnings = []

    // FIRST: Add this LEGO's vocab (so its phrases can use it)
    const legoWords = normalize(lego.target_text).split(' ').filter(w => w)
    legoWords.forEach(w => vocabSet.add(w))

    // Also add components if M-type (these become available vocabulary)
    if (lego.type === 'M' && lego.components) {
      for (const comp of lego.components) {
        const compWords = normalize(comp.target).split(' ').filter(w => w)
        compWords.forEach(w => vocabSet.add(w))
      }
    }

    // Get phrases for this LEGO
    const legoPhrases = phrases.filter(
      p => p.seed_number === lego.seed_number && p.lego_index === lego.lego_index
    )

    // Check each phrase for vocab violations
    for (const phrase of legoPhrases) {
      const phraseWords = normalize(phrase.target_text).split(' ').filter(w => w)
      const unknownWords = phraseWords.filter(w => !vocabSet.has(w))
      if (unknownWords.length > 0) {
        issues.push(`Unknown: ${unknownWords.join(', ')} in "${phrase.target_text}"`)
      }
    }

    // Check phrase count (after first 5 seeds)
    if (lego.seed_number > 5) {
      if (legoPhrases.length < 7) {
        issues.push(`Only ${legoPhrases.length} phrases (MIN: 7)`)
      } else if (legoPhrases.length < 10) {
        warnings.push(`Only ${legoPhrases.length} phrases (TARGET: 10)`)
      }
    }

    // Check syllable distribution
    const syllableCounts = legoPhrases.map(p => countSyllables(p.target_text))
    const maxSyllables = Math.max(...syllableCounts, 0)

    if (lego.seed_number > 5 && maxSyllables < 10) {
      warnings.push(`No long phrases (max ${maxSyllables} syl, need 10+)`)
    }

    // Categorize result
    if (issues.length > 0) {
      results.rejected.push({
        legoKey,
        lego: lego.target_text,
        known: lego.known_text,
        issues,
        warnings,
        phraseCount: legoPhrases.length
      })
    } else if (warnings.length > 0) {
      results.flagged.push({
        legoKey,
        lego: lego.target_text,
        known: lego.known_text,
        warnings,
        phraseCount: legoPhrases.length
      })
    } else {
      results.passed.push({
        legoKey,
        lego: lego.target_text,
        known: lego.known_text,
        phraseCount: legoPhrases.length
      })
    }
  }

  // Output results
  console.log('='.repeat(60))
  console.log('GATE VALIDATION RESULTS')
  console.log('='.repeat(60))
  console.log(`PASSED:   ${results.passed.length}`)
  console.log(`FLAGGED:  ${results.flagged.length}`)
  console.log(`REJECTED: ${results.rejected.length}`)

  if (results.rejected.length > 0) {
    console.log('\n--- REJECTED (must fix) ---')
    for (const r of results.rejected) {
      console.log(`\n${r.legoKey}: ${r.lego} "${r.known}" (${r.phraseCount} phr)`)
      r.issues.forEach(i => console.log(`  ✗ ${i}`))
    }
  }

  if (results.flagged.length > 0) {
    console.log('\n--- FLAGGED (should improve) ---')
    for (const f of results.flagged) {
      console.log(`\n${f.legoKey}: ${f.lego} "${f.known}" (${f.phraseCount} phr)`)
      f.warnings.forEach(w => console.log(`  ⚠ ${w}`))
    }
  }

  // Summary stats
  const totalPhrases = phrases.length
  const avgPhrases = (totalPhrases / legos.length).toFixed(1)
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total LEGOs: ${legos.length}`)
  console.log(`Total phrases: ${totalPhrases}`)
  console.log(`Avg phrases/LEGO: ${avgPhrases}`)
  console.log(`Vocabulary size: ${vocabSet.size} words`)
}

main().catch(console.error)
