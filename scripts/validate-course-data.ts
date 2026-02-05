/**
 * validate-course-data.ts — Validate course data integrity in Supabase
 *
 * Checks every course for:
 *   Level A: Cycle integrity (text + audio completeness on every LEGO and phrase)
 *   Level B: Round integrity (correct structure per LEGO)
 *   Level C: Introduction audio presence and consistency
 *
 * Usage:
 *   npx tsx scripts/validate-course-data.ts                    # all courses
 *   npx tsx scripts/validate-course-data.ts cym_for_eng        # one course
 *   npx tsx scripts/validate-course-data.ts --seeds 1-10       # limit seed range
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Parse .env manually (no dotenv dependency needed)
const envPath = resolve(__dirname, '../.env')
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const val = match[2].trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Lego {
  seed_number: number
  lego_index: number
  known_text: string
  target_text: string
  type: string
  is_new: boolean
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  presentation_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
}

interface Phrase {
  seed_number: number
  lego_index: number
  known_text: string
  target_text: string
  phrase_role: string
  position: number | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
}

interface CycleIssue {
  severity: 'error' | 'warning'
  location: string  // e.g. "S0001L01 (debut)"
  field: string
  message: string
}

interface RoundReport {
  legoKey: string
  seedNumber: number
  legoIndex: number
  knownText: string
  targetText: string
  valid: boolean
  buildCount: number
  useCount: number
  issues: CycleIssue[]
}

interface CourseReport {
  courseCode: string
  totalLegos: number
  totalNewLegos: number
  totalPhrases: number
  totalRounds: number
  validRounds: number
  invalidRounds: number
  issues: {
    errors: number
    warnings: number
  }
  rounds: RoundReport[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function legoKey(seedNum: number, legoIdx: number): string {
  return `S${String(seedNum).padStart(4, '0')}L${String(legoIdx).padStart(2, '0')}`
}

function validateLego(lego: Lego, context: string, introFallback: Set<string>): CycleIssue[] {
  const issues: CycleIssue[] = []
  const lk = legoKey(lego.seed_number, lego.lego_index)

  // Text
  if (!lego.known_text?.trim()) {
    issues.push({ severity: 'error', location: context, field: 'known_text', message: 'Empty known_text' })
  }
  if (!lego.target_text?.trim()) {
    issues.push({ severity: 'error', location: context, field: 'target_text', message: 'Empty target_text' })
  }

  // Audio — debut needs known_audio_id + target1 + target2
  if (!lego.known_audio_id) {
    issues.push({ severity: 'error', location: `${context} (debut)`, field: 'known_audio_id', message: 'Missing known audio' })
  }
  if (!lego.target1_audio_id) {
    issues.push({ severity: 'error', location: `${context} (debut)`, field: 'target1_audio_id', message: 'Missing target1 audio' })
  }
  if (!lego.target2_audio_id) {
    issues.push({ severity: 'warning', location: `${context} (debut)`, field: 'target2_audio_id', message: 'Missing target2 audio (second voice)' })
  }

  // Intro needs presentation_audio_id (check direct column, then lego_introductions/course_audio fallback)
  if (!lego.presentation_audio_id && !introFallback.has(lk)) {
    issues.push({ severity: 'error', location: `${context} (intro)`, field: 'presentation_audio_id', message: 'Missing presentation audio (checked course_legos + lego_introductions + course_audio)' })
  }

  return issues
}

function validatePhrase(phrase: Phrase, context: string): CycleIssue[] {
  const issues: CycleIssue[] = []

  if (!phrase.known_text?.trim()) {
    issues.push({ severity: 'error', location: context, field: 'known_text', message: 'Empty known_text' })
  }
  if (!phrase.target_text?.trim()) {
    issues.push({ severity: 'error', location: context, field: 'target_text', message: 'Empty target_text' })
  }
  if (!phrase.known_audio_id) {
    issues.push({ severity: 'error', location: context, field: 'known_audio_id', message: 'Missing known audio' })
  }
  if (!phrase.target1_audio_id) {
    issues.push({ severity: 'error', location: context, field: 'target1_audio_id', message: 'Missing target1 audio' })
  }
  if (!phrase.target2_audio_id) {
    issues.push({ severity: 'warning', location: context, field: 'target2_audio_id', message: 'Missing target2 audio (second voice)' })
  }

  return issues
}

// ---------------------------------------------------------------------------
// Course validation
// ---------------------------------------------------------------------------

async function validateCourse(
  courseCode: string,
  startSeed?: number,
  endSeed?: number
): Promise<CourseReport> {
  // Query LEGOs
  let legoQuery = supabase
    .from('course_legos')
    .select('seed_number, lego_index, known_text, target_text, type, is_new, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms')
    .eq('course_code', courseCode)
    .order('seed_number', { ascending: true })
    .order('lego_index', { ascending: true })

  if (startSeed !== undefined) legoQuery = legoQuery.gte('seed_number', startSeed)
  if (endSeed !== undefined) legoQuery = legoQuery.lte('seed_number', endSeed)

  // Query phrases
  let phraseQuery = supabase
    .from('course_practice_phrases')
    .select('seed_number, lego_index, known_text, target_text, phrase_role, position, known_audio_id, target1_audio_id, target2_audio_id')
    .eq('course_code', courseCode)
    .order('seed_number', { ascending: true })
    .order('lego_index', { ascending: true })
    .order('position', { ascending: true })

  if (startSeed !== undefined) phraseQuery = phraseQuery.gte('seed_number', startSeed)
  if (endSeed !== undefined) phraseQuery = phraseQuery.lte('seed_number', endSeed)

  // Query lego_introductions (legacy storage for presentation audio)
  const introQuery = supabase
    .from('lego_introductions')
    .select('lego_id, presentation_audio_id, audio_uuid')
    .eq('course_code', courseCode)

  // Query course_audio with role=presentation (another fallback)
  const presAudioQuery = supabase
    .from('course_audio')
    .select('id, lego_id')
    .eq('course_code', courseCode)
    .eq('role', 'presentation')
    .not('lego_id', 'is', null)

  const [legosResult, phrasesResult, introResult, presAudioResult] = await Promise.all([
    legoQuery, phraseQuery, introQuery, presAudioQuery
  ])

  if (legosResult.error) throw new Error(`LEGOs query failed: ${legosResult.error.message}`)
  if (phrasesResult.error) throw new Error(`Phrases query failed: ${phrasesResult.error.message}`)
  // Don't fail on missing tables — legacy tables may not exist for all deployments
  if (introResult.error) console.warn(`  (lego_introductions query failed: ${introResult.error.message})`)
  if (presAudioResult.error) console.warn(`  (course_audio presentation query failed: ${presAudioResult.error.message})`)

  const legos = (legosResult.data || []) as Lego[]
  const phrases = (phrasesResult.data || []) as Phrase[]

  // Build fallback presentation audio lookup: lego_id → true
  const introFallback = new Set<string>()
  for (const row of (introResult.data || []) as { lego_id: string; presentation_audio_id: string | null; audio_uuid: string | null }[]) {
    if (row.presentation_audio_id || row.audio_uuid) {
      introFallback.add(row.lego_id)
    }
  }
  for (const row of (presAudioResult.data || []) as { id: string; lego_id: string }[]) {
    introFallback.add(row.lego_id)
  }
  const introFallbackCount = introFallback.size
  if (introFallbackCount > 0) {
    console.log(`  Found ${introFallbackCount} presentation audio entries via lego_introductions/course_audio fallback`)
  }

  // Group phrases by LEGO
  const phrasesByLego = new Map<string, { build: Phrase[]; use: Phrase[] }>()
  const practiceDeferred = new Map<string, Phrase[]>()
  for (const p of phrases) {
    const key = `${p.seed_number}:${p.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [] })
    const group = phrasesByLego.get(key)!
    if (p.phrase_role === 'component') continue
    if (p.phrase_role === 'build') group.build.push(p)
    else if (p.phrase_role === 'use') group.use.push(p)
    else if (p.phrase_role === 'practice') {
      // Deferred — classified after all phrases are grouped
      if (!practiceDeferred.has(key)) practiceDeferred.set(key, [])
      practiceDeferred.get(key)!.push(p)
    }
  }

  // Classify deferred 'practice' phrases per LEGO:
  // If the LEGO has explicit USE phrases → practice goes to BUILD
  // If the LEGO has NO USE phrases → practice goes to USE
  for (const [key, practices] of practiceDeferred.entries()) {
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [] })
    const group = phrasesByLego.get(key)!
    if (group.use.length > 0) {
      group.build.push(...practices)
    } else {
      group.use.push(...practices)
    }
  }

  // Validate each NEW lego as a round
  const newLegos = legos.filter(l => l.is_new)
  const rounds: RoundReport[] = []

  for (const lego of newLegos) {
    const lk = legoKey(lego.seed_number, lego.lego_index)
    const phraseKey = `${lego.seed_number}:${lego.lego_index}`
    const legoIssues: CycleIssue[] = []

    // Validate LEGO itself (intro + debut audio)
    legoIssues.push(...validateLego(lego, lk, introFallback))

    // Validate phrases
    const phraseGroup = phrasesByLego.get(phraseKey) || { build: [], use: [] }
    const buildCount = phraseGroup.build.length
    const useCount = phraseGroup.use.length

    if (buildCount === 0) {
      legoIssues.push({ severity: 'warning', location: lk, field: 'structure', message: 'No BUILD phrases' })
    }
    if (useCount === 0) {
      legoIssues.push({ severity: 'warning', location: lk, field: 'structure', message: 'No USE phrases (needed for spaced rep & consolidation)' })
    }

    for (const bp of phraseGroup.build) {
      legoIssues.push(...validatePhrase(bp, `${lk} build "${bp.target_text?.slice(0, 30)}"`))
    }
    for (const up of phraseGroup.use) {
      legoIssues.push(...validatePhrase(up, `${lk} use "${up.target_text?.slice(0, 30)}"`))
    }

    const errors = legoIssues.filter(i => i.severity === 'error')
    rounds.push({
      legoKey: lk,
      seedNumber: lego.seed_number,
      legoIndex: lego.lego_index,
      knownText: lego.known_text,
      targetText: lego.target_text,
      valid: errors.length === 0,
      buildCount,
      useCount,
      issues: legoIssues,
    })
  }

  const validRounds = rounds.filter(r => r.valid).length
  const allIssues = rounds.flatMap(r => r.issues)

  return {
    courseCode,
    totalLegos: legos.length,
    totalNewLegos: newLegos.length,
    totalPhrases: phrases.length,
    totalRounds: rounds.length,
    validRounds,
    invalidRounds: rounds.length - validRounds,
    issues: {
      errors: allIssues.filter(i => i.severity === 'error').length,
      warnings: allIssues.filter(i => i.severity === 'warning').length,
    },
    rounds,
  }
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReport(report: CourseReport): void {
  const status = report.invalidRounds === 0 ? '✅ PASS' : '❌ FAIL'
  console.log(`\n${'='.repeat(70)}`)
  console.log(`${status}  ${report.courseCode}`)
  console.log(`${'='.repeat(70)}`)
  console.log(`  LEGOs: ${report.totalLegos} total, ${report.totalNewLegos} new (= ${report.totalRounds} rounds)`)
  console.log(`  Phrases: ${report.totalPhrases}`)
  console.log(`  Rounds: ${report.validRounds}/${report.totalRounds} valid`)
  console.log(`  Issues: ${report.issues.errors} errors, ${report.issues.warnings} warnings`)

  // Print invalid rounds
  const invalidRounds = report.rounds.filter(r => !r.valid)
  if (invalidRounds.length > 0) {
    console.log(`\n  Invalid rounds (${invalidRounds.length}):`)
    for (const r of invalidRounds.slice(0, 20)) {
      console.log(`\n  ${r.legoKey} "${r.knownText}" → "${r.targetText}" (${r.buildCount} build, ${r.useCount} use)`)
      for (const issue of r.issues.filter(i => i.severity === 'error')) {
        console.log(`    ❌ ${issue.location}: ${issue.message}`)
      }
    }
    if (invalidRounds.length > 20) {
      console.log(`    ... and ${invalidRounds.length - 20} more invalid rounds`)
    }
  }

  // Print warning-only summary (rounds that are valid but have warnings)
  const warningRounds = report.rounds.filter(r => r.valid && r.issues.some(i => i.severity === 'warning'))
  if (warningRounds.length > 0) {
    console.log(`\n  Rounds with warnings (${warningRounds.length}):`)
    // Group by warning type
    const warningCounts = new Map<string, number>()
    for (const r of warningRounds) {
      for (const w of r.issues.filter(i => i.severity === 'warning')) {
        const key = w.message
        warningCounts.set(key, (warningCounts.get(key) || 0) + 1)
      }
    }
    for (const [msg, count] of warningCounts.entries()) {
      console.log(`    ⚠️  ${msg}: ${count} occurrence(s)`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let courseFilter: string | undefined
  let startSeed: number | undefined
  let endSeed: number | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds' && args[i + 1]) {
      const [s, e] = args[i + 1].split('-').map(Number)
      startSeed = s
      endSeed = e || s
      i++
    } else if (!args[i].startsWith('--')) {
      courseFilter = args[i]
    }
  }

  // Get list of courses
  let courses: string[]
  if (courseFilter) {
    courses = [courseFilter]
  } else {
    const { data, error } = await supabase
      .from('courses')
      .select('course_code')
      .order('course_code')
    if (error) throw new Error(`Failed to list courses: ${error.message}`)
    courses = (data || []).map((c: any) => c.course_code)
  }

  console.log(`Validating ${courses.length} course(s)${startSeed ? ` (seeds ${startSeed}-${endSeed})` : ''}...`)

  const reports: CourseReport[] = []
  for (const code of courses) {
    try {
      const report = await validateCourse(code, startSeed, endSeed)
      reports.push(report)
      printReport(report)
    } catch (err: any) {
      console.error(`\n❌ ${code}: ${err.message}`)
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`)
  console.log('SUMMARY')
  console.log(`${'='.repeat(70)}`)
  const passing = reports.filter(r => r.invalidRounds === 0)
  const failing = reports.filter(r => r.invalidRounds > 0)
  console.log(`  Courses: ${reports.length} total, ${passing.length} passing, ${failing.length} failing`)
  const totalErrors = reports.reduce((sum, r) => sum + r.issues.errors, 0)
  const totalWarnings = reports.reduce((sum, r) => sum + r.issues.warnings, 0)
  console.log(`  Total: ${totalErrors} errors, ${totalWarnings} warnings`)

  if (failing.length > 0) {
    console.log(`\n  Failing courses:`)
    for (const r of failing) {
      console.log(`    ❌ ${r.courseCode}: ${r.invalidRounds}/${r.totalRounds} invalid rounds (${r.issues.errors} errors)`)
    }
  }

  process.exit(failing.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
