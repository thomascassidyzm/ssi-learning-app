/**
 * Find UNTRODDEN paths in the Spanish network
 *
 * Looking for:
 * 1. Isolated LEGOs (few connections - need more phrases)
 * 2. Weak edges (only 1-2 phrases use this pair - could reinforce)
 * 3. Semantic gaps (LEGOs that SHOULD connect but don't)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const COURSE_CODE = 'spa_for_eng'

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
      i++
    }
  }

  return result
}

async function main() {
  console.log('🔍 Finding untrodden paths in Spanish network...\n')

  // Load LEGOs
  const { data: legos } = await supabase
    .from('lego_cycles')
    .select('lego_id, seed_number, lego_index, known_text, target_text')
    .eq('course_code', COURSE_CODE)
    .order('seed_number')
    .order('lego_index')

  console.log(`✓ Loaded ${legos.length} LEGOs`)

  const legoMap = new Map()
  const legoById = new Map()

  for (const lego of legos) {
    const targetNorm = normalize(lego.target_text)
    if (targetNorm) legoMap.set(targetNorm, lego.lego_id)
    legoById.set(lego.lego_id, {
      id: lego.lego_id,
      target: lego.target_text,
      known: lego.known_text,
      seedNum: lego.seed_number,
    })
  }

  // Load phrases
  let allPhrases = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('practice_cycles')
      .select('id, target_text')
      .eq('course_code', COURSE_CODE)
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    allPhrases = allPhrases.concat(data)
    if (data.length < 1000) break
    offset += 1000
  }

  console.log(`✓ Loaded ${allPhrases.length} phrases`)

  // Build connection graph
  const edges = new Map()
  const connectionCount = new Map() // lego_id → number of connections

  for (const phrase of allPhrases) {
    const legoIds = decomposePhrase(phrase.target_text, legoMap)

    for (let i = 0; i < legoIds.length - 1; i++) {
      const key = `${legoIds[i]}→${legoIds[i + 1]}`
      edges.set(key, (edges.get(key) || 0) + 1)
    }

    // Track connection count per LEGO
    for (const id of legoIds) {
      connectionCount.set(id, (connectionCount.get(id) || 0) + 1)
    }
  }

  console.log(`✓ Found ${edges.size} unique connections\n`)

  // ============================================================================
  // 1. ISOLATED LEGOS (few connections)
  // ============================================================================
  console.log('=' .repeat(80))
  console.log('🏝️  ISOLATED LEGOS (< 5 phrase appearances)')
  console.log('    These LEGOs need more phrases to connect them to the network')
  console.log('=' .repeat(80))

  const isolated = []
  for (const lego of legos) {
    const count = connectionCount.get(lego.lego_id) || 0
    if (count < 5) {
      isolated.push({ ...legoById.get(lego.lego_id), count })
    }
  }

  isolated.sort((a, b) => a.count - b.count)

  console.log(`\nFound ${isolated.length} LEGOs with < 5 connections:\n`)
  for (const lego of isolated.slice(0, 50)) {
    console.log(`  [${lego.count}] ${lego.target} → "${lego.known}"`)
  }

  // ============================================================================
  // 2. WEAK EDGES (only 1-2 uses)
  // ============================================================================
  console.log('\n\n' + '=' .repeat(80))
  console.log('🔗 WEAK EDGES (only 1-2 phrase uses)')
  console.log('    These connections exist but could use reinforcement')
  console.log('=' .repeat(80))

  const weakEdges = []
  for (const [edge, count] of edges) {
    if (count <= 2) {
      const [sourceId, targetId] = edge.split('→')
      const source = legoById.get(sourceId)
      const target = legoById.get(targetId)
      if (source && target) {
        weakEdges.push({ source, target, count })
      }
    }
  }

  console.log(`\nFound ${weakEdges.length} weak edges (count ≤ 2):\n`)

  // Group by count
  const count1 = weakEdges.filter(e => e.count === 1)
  const count2 = weakEdges.filter(e => e.count === 2)

  console.log(`Edges with count=1: ${count1.length}`)
  console.log(`Edges with count=2: ${count2.length}`)

  console.log('\nSample weak edges (count=1):\n')
  for (const e of count1.slice(0, 30)) {
    console.log(`  ${e.source.target} → ${e.target.target}`)
    console.log(`     "${e.source.known}" → "${e.target.known}"`)
  }

  // ============================================================================
  // 3. SEMANTIC GAPS - LEGOs that SHOULD connect
  // ============================================================================
  console.log('\n\n' + '=' .repeat(80))
  console.log('🧩 SEMANTIC GAPS - Common verbs missing object connections')
  console.log('    Verbs that could take more objects/complements')
  console.log('=' .repeat(80))

  // Find common verbs (high connection count)
  const verbPatterns = ['quiero', 'puedo', 'necesito', 'tengo', 'voy a', 'estoy', 'me gusta', 'prefiero']
  const verbLegos = legos.filter(l =>
    verbPatterns.some(v => normalize(l.target_text).includes(v))
  )

  console.log(`\nFound ${verbLegos.length} verb-like LEGOs`)

  // Find nouns/objects (things that could be verb objects)
  const nounLegos = legos.filter(l => {
    const known = l.known_text.toLowerCase()
    // Likely nouns: "the X", "a X", "my X", single words without "to"
    return (known.startsWith('the ') ||
            known.startsWith('a ') ||
            known.startsWith('my ') ||
            (!known.includes(' to ') && !known.startsWith('to ') && l.target_text.split(' ').length === 1))
  })

  console.log(`Found ${nounLegos.length} noun-like LEGOs\n`)

  // Find verb-noun pairs that DON'T have edges
  const missingVerbNoun = []

  for (const verb of verbLegos.slice(0, 20)) { // Top 20 verbs
    for (const noun of nounLegos.slice(0, 50)) { // Top 50 nouns
      const key1 = `${verb.lego_id}→${noun.lego_id}`
      const key2 = `${noun.lego_id}→${verb.lego_id}`

      if (!edges.has(key1) && !edges.has(key2)) {
        missingVerbNoun.push({
          verb: legoById.get(verb.lego_id),
          noun: legoById.get(noun.lego_id),
        })
      }
    }
  }

  console.log(`Found ${missingVerbNoun.length} potential verb+noun combinations without phrases:\n`)

  for (const pair of missingVerbNoun.slice(0, 40)) {
    console.log(`  "${pair.verb.target}" + "${pair.noun.target}"`)
    console.log(`     "${pair.verb.known}" + "${pair.noun.known}"`)
    console.log()
  }

  // ============================================================================
  // 4. CLUSTER ANALYSIS - Find disconnected regions
  // ============================================================================
  console.log('\n' + '=' .repeat(80))
  console.log('🗺️  NETWORK CLUSTERS')
  console.log('    Finding regions of the network that don\'t connect')
  console.log('=' .repeat(80))

  // Build adjacency list
  const adj = new Map()
  for (const [edge] of edges) {
    const [s, t] = edge.split('→')
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s).add(t)
    adj.get(t).add(s)
  }

  // Find connected components using BFS
  const visited = new Set()
  const clusters = []

  for (const lego of legos) {
    if (visited.has(lego.lego_id)) continue
    if (!adj.has(lego.lego_id)) {
      // Completely isolated
      clusters.push([lego.lego_id])
      visited.add(lego.lego_id)
      continue
    }

    // BFS
    const cluster = []
    const queue = [lego.lego_id]

    while (queue.length > 0) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      cluster.push(current)

      const neighbors = adj.get(current) || []
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push(n)
      }
    }

    clusters.push(cluster)
  }

  clusters.sort((a, b) => b.length - a.length)

  console.log(`\nFound ${clusters.length} clusters:`)
  console.log(`  Main cluster: ${clusters[0]?.length || 0} LEGOs`)

  if (clusters.length > 1) {
    console.log(`\nSmaller clusters (disconnected from main network):\n`)
    for (const cluster of clusters.slice(1, 10)) {
      console.log(`  Cluster of ${cluster.length} LEGOs:`)
      for (const id of cluster.slice(0, 5)) {
        const lego = legoById.get(id)
        if (lego) console.log(`    - ${lego.target} ("${lego.known}")`)
      }
      if (cluster.length > 5) console.log(`    ... and ${cluster.length - 5} more`)
      console.log()
    }
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '=' .repeat(80))
  console.log('📊 SUMMARY - Where to focus new phrase creation')
  console.log('=' .repeat(80))
  console.log(`
Total LEGOs: ${legos.length}
Total phrases: ${allPhrases.length}
Unique connections: ${edges.size}

GAPS FOUND:
  - Isolated LEGOs (< 5 uses): ${isolated.length}
  - Weak edges (count ≤ 2): ${weakEdges.length}
  - Potential verb+noun gaps: ${missingVerbNoun.length}
  - Disconnected clusters: ${clusters.length - 1}

RECOMMENDATIONS:
  1. Create phrases for the ${isolated.length} isolated LEGOs
  2. Reinforce the ${count1.length} single-use connections
  3. Add verb+object phrases for semantic gaps
  4. Bridge disconnected clusters to main network
`)
}

main().catch(console.error)
