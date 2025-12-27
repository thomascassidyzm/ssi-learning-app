/**
 * Build LEGO connection graph from phrase co-occurrence
 *
 * Analyzes all phrases, decomposes them into LEGOs (greedy),
 * and builds directional connection weights (A → B means A precedes B)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const normalize = (text) => text?.toLowerCase().trim().replace(/\s+/g, ' ') || ''

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
        longestMatch = { legoId, text: candidate }
        longestLength = len
        break
      }
    }

    if (longestMatch) {
      result.push(longestMatch)
      i += longestLength
    } else {
      // Skip unmatched word
      i++
    }
  }
  return result
}

async function buildConnections(courseCode) {
  console.log(`\nBuilding LEGO connections for: ${courseCode}`)
  console.log('='.repeat(50))

  // Get all LEGOs
  const { data: legos, error: legoError } = await supabase
    .from('course_legos')
    .select('lego_id, known_text, target_text')
    .eq('course_code', courseCode)

  if (legoError) {
    console.error('Error fetching LEGOs:', legoError)
    return
  }

  // Build lookup map (target text → lego_id)
  const targetMap = new Map()
  const legoInfo = new Map()

  for (const l of legos) {
    const targetNorm = normalize(l.target_text)
    if (targetNorm) {
      targetMap.set(targetNorm, l.lego_id)
      legoInfo.set(l.lego_id, { known: l.known_text, target: l.target_text })
    }
  }

  console.log(`Loaded ${legos.length} LEGOs (${targetMap.size} unique target texts)`)

  // Get all phrases
  const { data: phrases, error: phraseError } = await supabase
    .from('course_practice_phrases')
    .select('id, target_text')
    .eq('course_code', courseCode)

  if (phraseError) {
    console.error('Error fetching phrases:', phraseError)
    return
  }

  console.log(`Loaded ${phrases.length} phrases`)

  // Build connection graph
  // Key: "sourceId→targetId", Value: count
  const connections = new Map()
  let phrasesWithPaths = 0
  let totalConnections = 0

  for (const phrase of phrases) {
    const decomp = decomposePhrase(phrase.target_text, targetMap)

    if (decomp.length >= 2) {
      phrasesWithPaths++

      // Record directional connections between consecutive LEGOs
      for (let i = 0; i < decomp.length - 1; i++) {
        const source = decomp[i].legoId
        const target = decomp[i + 1].legoId
        const key = `${source}→${target}`

        connections.set(key, (connections.get(key) || 0) + 1)
        totalConnections++
      }
    }
  }

  console.log(`\nResults:`)
  console.log(`  Phrases with 2+ LEGOs: ${phrasesWithPaths} / ${phrases.length} (${(phrasesWithPaths/phrases.length*100).toFixed(1)}%)`)
  console.log(`  Unique connections: ${connections.size}`)
  console.log(`  Total connection instances: ${totalConnections}`)

  // Sort by frequency
  const sorted = [...connections.entries()]
    .map(([key, count]) => {
      const [source, target] = key.split('→')
      return { source, target, count }
    })
    .sort((a, b) => b.count - a.count)

  console.log(`\nTop 20 connections:`)
  for (const conn of sorted.slice(0, 20)) {
    const srcInfo = legoInfo.get(conn.source)
    const tgtInfo = legoInfo.get(conn.target)
    console.log(`  ${conn.count}× "${srcInfo?.target}" → "${tgtInfo?.target}"`)
    console.log(`       (${srcInfo?.known} → ${tgtInfo?.known})`)
  }

  // Build per-LEGO stats
  const legoStats = new Map()

  for (const { source, target, count } of sorted) {
    // Outgoing (leads to)
    if (!legoStats.has(source)) {
      legoStats.set(source, { leadsTo: [], followsFrom: [] })
    }
    legoStats.get(source).leadsTo.push({ target, count })

    // Incoming (follows from)
    if (!legoStats.has(target)) {
      legoStats.set(target, { leadsTo: [], followsFrom: [] })
    }
    legoStats.get(target).followsFrom.push({ source, count })
  }

  // Sample a LEGO's connections
  const sampleLego = 'S0001L02' // "siarad" in Welsh
  const stats = legoStats.get(sampleLego)

  if (stats) {
    const info = legoInfo.get(sampleLego)
    console.log(`\nSample LEGO: ${sampleLego} ("${info?.target}" / "${info?.known}")`)

    console.log(`  Most often follows:`)
    for (const { source, count } of stats.followsFrom.slice(0, 5)) {
      const srcInfo = legoInfo.get(source)
      console.log(`    ${count}× "${srcInfo?.target}"`)
    }

    console.log(`  Most often leads to:`)
    for (const { target, count } of stats.leadsTo.slice(0, 5)) {
      const tgtInfo = legoInfo.get(target)
      console.log(`    ${count}× "${tgtInfo?.target}"`)
    }
  }

  // Return the data for potential use
  return {
    connections: sorted,
    legoStats,
    legoInfo
  }
}

// Run for Welsh North
buildConnections('cym_n_for_eng').catch(console.error)
