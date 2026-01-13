/**
 * Analyze Spanish course network for potential new phrases
 *
 * This script:
 * 1. Loads all LEGOs for the Spanish course
 * 2. Loads existing phrases and their LEGO decompositions
 * 3. Builds a network graph
 * 4. Finds paths that COULD be phrases but aren't yet
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const COURSE_CODE = 'spa_for_eng'  // Spanish for English

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Normalize text for matching
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
        longestMatch = legoId
        longestLength = len
        break
      }
    }

    if (longestMatch) {
      result.push(longestMatch)
      i += longestLength
    } else {
      i++ // Skip unmatched word
    }
  }

  return result
}

async function main() {
  console.log('🔍 Analyzing Spanish course network...\n')

  // 1. Load all LEGOs
  console.log('Loading LEGOs...')
  const { data: legos, error: legoError } = await supabase
    .from('lego_cycles')
    .select('lego_id, seed_number, lego_index, known_text, target_text')
    .eq('course_code', COURSE_CODE)
    .order('seed_number')
    .order('lego_index')

  if (legoError) {
    console.error('Error loading LEGOs:', legoError)
    return
  }

  console.log(`✓ Loaded ${legos.length} LEGOs\n`)

  // Build lookup maps
  const legoMap = new Map() // normalized text → lego_id
  const legoById = new Map() // lego_id → lego data

  for (const lego of legos) {
    const targetNorm = normalize(lego.target_text)
    if (targetNorm) {
      legoMap.set(targetNorm, lego.lego_id)
    }
    legoById.set(lego.lego_id, {
      id: lego.lego_id,
      target: lego.target_text,
      known: lego.known_text,
      seedNum: lego.seed_number,
    })
  }

  // 2. Load all phrases
  console.log('Loading phrases...')
  let allPhrases = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data: phrasePage, error: phraseError } = await supabase
      .from('practice_cycles')
      .select('id, target_text')
      .eq('course_code', COURSE_CODE)
      .range(offset, offset + pageSize - 1)

    if (phraseError) {
      console.error('Error loading phrases:', phraseError)
      return
    }
    if (!phrasePage || phrasePage.length === 0) break

    allPhrases = allPhrases.concat(phrasePage)
    if (phrasePage.length < pageSize) break
    offset += pageSize
  }

  console.log(`✓ Loaded ${allPhrases.length} phrases\n`)

  // 3. Build connection graph from phrases
  console.log('Building network graph...')
  const edges = new Map() // "L1→L2" → count
  const existingPhraseTexts = new Set() // normalized phrase texts

  for (const phrase of allPhrases) {
    const legoIds = decomposePhrase(phrase.target_text, legoMap)
    existingPhraseTexts.add(normalize(phrase.target_text))

    // Create edges between consecutive LEGOs
    for (let i = 0; i < legoIds.length - 1; i++) {
      const key = `${legoIds[i]}→${legoIds[i + 1]}`
      edges.set(key, (edges.get(key) || 0) + 1)
    }
  }

  console.log(`✓ Found ${edges.size} unique LEGO connections\n`)

  // 4. Build adjacency list for path finding
  const adjacency = new Map() // lego_id → Set of connected lego_ids

  for (const [edge, count] of edges) {
    const [source, target] = edge.split('→')

    if (!adjacency.has(source)) adjacency.set(source, new Set())
    if (!adjacency.has(target)) adjacency.set(target, new Set())

    adjacency.get(source).add(target)
    // For bidirectional exploration
    adjacency.get(target).add(source)
  }

  // 5. Find potential new phrases by exploring 2-3 hop paths
  console.log('Finding potential new phrases...\n')

  const potentialPhrases = []
  const checkedPaths = new Set()

  // Try 2-LEGO combinations
  for (const [l1, neighbors1] of adjacency) {
    for (const l2 of neighbors1) {
      const path = [l1, l2]
      const pathKey = path.join('→')
      if (checkedPaths.has(pathKey)) continue
      checkedPaths.add(pathKey)

      // Build phrase text
      const lego1 = legoById.get(l1)
      const lego2 = legoById.get(l2)
      if (!lego1 || !lego2) continue

      const phraseText = `${lego1.target} ${lego2.target}`
      const phraseNorm = normalize(phraseText)

      // Check if this exact phrase already exists
      if (!existingPhraseTexts.has(phraseNorm)) {
        const edgeStrength = edges.get(`${l1}→${l2}`) || edges.get(`${l2}→${l1}`) || 0
        potentialPhrases.push({
          path,
          target: phraseText,
          known: `${lego1.known} ${lego2.known}`,
          strength: edgeStrength,
          length: 2,
        })
      }
    }
  }

  // Try 3-LEGO combinations
  for (const [l1, neighbors1] of adjacency) {
    for (const l2 of neighbors1) {
      const neighbors2 = adjacency.get(l2)
      if (!neighbors2) continue

      for (const l3 of neighbors2) {
        if (l3 === l1) continue // No loops

        const path = [l1, l2, l3]
        const pathKey = path.join('→')
        if (checkedPaths.has(pathKey)) continue
        checkedPaths.add(pathKey)

        const lego1 = legoById.get(l1)
        const lego2 = legoById.get(l2)
        const lego3 = legoById.get(l3)
        if (!lego1 || !lego2 || !lego3) continue

        const phraseText = `${lego1.target} ${lego2.target} ${lego3.target}`
        const phraseNorm = normalize(phraseText)

        if (!existingPhraseTexts.has(phraseNorm)) {
          const strength1 = edges.get(`${l1}→${l2}`) || edges.get(`${l2}→${l1}`) || 0
          const strength2 = edges.get(`${l2}→${l3}`) || edges.get(`${l3}→${l2}`) || 0

          potentialPhrases.push({
            path,
            target: phraseText,
            known: `${lego1.known} ${lego2.known} ${lego3.known}`,
            strength: Math.min(strength1, strength2),
            length: 3,
          })
        }
      }
    }
  }

  // Sort by strength (phrases with stronger connections are better candidates)
  potentialPhrases.sort((a, b) => b.strength - a.strength)

  // 6. Output results
  console.log('=' .repeat(80))
  console.log('POTENTIAL NEW PHRASES (by connection strength)')
  console.log('=' .repeat(80))
  console.log()

  // Top 50 2-word phrases
  const twoWord = potentialPhrases.filter(p => p.length === 2).slice(0, 50)
  console.log('📝 TOP 2-WORD PHRASES:\n')
  for (const p of twoWord) {
    console.log(`  [${p.strength}] ${p.target}`)
    console.log(`       → "${p.known}"`)
    console.log()
  }

  // Top 50 3-word phrases
  const threeWord = potentialPhrases.filter(p => p.length === 3).slice(0, 50)
  console.log('\n📝 TOP 3-WORD PHRASES:\n')
  for (const p of threeWord) {
    console.log(`  [${p.strength}] ${p.target}`)
    console.log(`       → "${p.known}"`)
    console.log()
  }

  // Summary stats
  console.log('\n' + '=' .repeat(80))
  console.log('SUMMARY')
  console.log('=' .repeat(80))
  console.log(`Total LEGOs: ${legos.length}`)
  console.log(`Total existing phrases: ${allPhrases.length}`)
  console.log(`Unique LEGO connections: ${edges.size}`)
  console.log(`Potential new 2-word phrases: ${potentialPhrases.filter(p => p.length === 2).length}`)
  console.log(`Potential new 3-word phrases: ${potentialPhrases.filter(p => p.length === 3).length}`)

  // Show strongest connections that might be underutilized
  console.log('\n\n' + '=' .repeat(80))
  console.log('STRONGEST CONNECTIONS (might need more phrases)')
  console.log('=' .repeat(80))

  const sortedEdges = [...edges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [edge, count] of sortedEdges) {
    const [sourceId, targetId] = edge.split('→')
    const source = legoById.get(sourceId)
    const target = legoById.get(targetId)
    if (source && target) {
      console.log(`  [${count}] ${source.target} → ${target.target}`)
    }
  }
}

main().catch(console.error)
