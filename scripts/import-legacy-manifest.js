#!/usr/bin/env node
/**
 * Import Legacy Course Manifest to Supabase
 *
 * Converts legacy JSON manifest format to new database schema:
 * - courses
 * - course_seeds
 * - course_legos
 * - course_practice_phrases
 * - audio_samples
 *
 * Usage:
 *   node scripts/import-legacy-manifest.js /path/to/course_manifest.json
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
 */

const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const { resolve } = require('path')

// Try to load from .env if dotenv is available
try {
  require('dotenv').config({ path: resolve(__dirname, '../packages/player-vue/.env') })
  require('dotenv').config({ path: resolve(__dirname, '../.env') })
} catch (e) {
  // dotenv not installed, use existing env vars
}

// Config
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY // Need service role for inserts

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing environment variables.')
  console.error('')
  console.error('Required:')
  console.error('  SUPABASE_URL (or VITE_SUPABASE_URL)')
  console.error('  SUPABASE_SERVICE_KEY (service_role key, not anon key)')
  console.error('')
  console.error('Get the service_role key from:')
  console.error('  Supabase Dashboard → Settings → API → service_role (secret)')
  console.error('')
  console.error('Run with:')
  console.error('  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=xxx node scripts/import-legacy-manifest.js manifest.json')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Map 2-letter to 3-letter language codes
const LANG_MAP = {
  en: 'eng', es: 'spa', cy: 'cym', it: 'ita', fr: 'fra',
  de: 'deu', pt: 'por', zh: 'zho', ja: 'jpn', ko: 'kor',
  ar: 'ara', nl: 'nld', ru: 'rus', pl: 'pol'
}
const toLang3 = (code) => LANG_MAP[code] || code

// Normalize text for audio lookup (trim, consistent spacing)
function normalizeText(text) {
  return text?.trim().replace(/\s+/g, ' ') || ''
}

async function importManifest(manifestPath) {
  console.log(`\n📂 Reading manifest: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf-8'))

  const courseCode = manifest.id // e.g., "en-es"
  const knownLang = toLang3(manifest.known) // e.g., "en" -> "eng"
  const targetLang = toLang3(manifest.target) // e.g., "es" -> "spa"

  console.log(`📚 Course: ${courseCode} (${knownLang} → ${targetLang})`)
  console.log(`📦 Slices: ${manifest.slices?.length || 0}`)

  // Track what we'll insert
  const courseSeeds = []
  const courseLegos = []
  const coursePracticePhrases = []
  const legoIntroductions = [] // LEGO introduction audio links
  const audioSamples = new Map() // Dedup by uuid

  // Build samples lookup for presentation audio matching
  const allSampleSources = [manifest.samples]
  for (const slice of manifest.slices || []) {
    if (slice.samples) allSampleSources.push(slice.samples)
  }
  const presentationLookup = new Map() // text -> sample
  for (const samplesObj of allSampleSources) {
    for (const [text, samples] of Object.entries(samplesObj || {})) {
      for (const sample of samples) {
        if (sample.role === 'presentation') {
          presentationLookup.set(text, sample)
        }
      }
    }
  }

  let seedNumber = 0

  // Process slices
  for (const slice of manifest.slices || []) {
    for (const seed of slice.seeds || []) {
      seedNumber++

      const seedKnownText = seed.node?.known?.text || seed.seed_sentence?.canonical || seed.seedSentence?.canonical
      const seedTargetText = seed.node?.target?.text

      if (!seedKnownText || !seedTargetText) {
        console.warn(`  ⚠️  Skipping seed ${seedNumber}: missing text`)
        continue
      }

      // Add seed
      courseSeeds.push({
        course_code: courseCode,
        seed_number: seedNumber,
        known_text: seedKnownText,
        target_text: seedTargetText,
        status: 'draft'
      })

      // Process introduction_items (LEGOs being introduced)
      // Note: seed sentence is in course_seeds, LEGOs start at index 1
      // Handle both snake_case and camelCase naming conventions
      const introItems = seed.introduction_items || seed.introductionItems || []
      let legoIndex = 0
      for (const intro of introItems) {
        legoIndex++

        const legoKnownText = intro.node?.known?.text
        const legoTargetText = intro.node?.target?.text

        if (!legoKnownText || !legoTargetText) {
          console.warn(`  ⚠️  Skipping lego in seed ${seedNumber}: missing text`)
          continue
        }

        // Determine type: A (atomic/single word) or M (molecular/phrase)
        const wordCount = legoTargetText.split(/\s+/).length
        const legoType = wordCount === 1 ? 'A' : 'M'

        // Add LEGO
        const legoId = `S${String(seedNumber).padStart(4, '0')}L${String(legoIndex).padStart(2, '0')}`
        courseLegos.push({
          course_code: courseCode,
          seed_number: seedNumber,
          lego_index: legoIndex,
          type: legoType,
          is_new: true,
          known_text: legoKnownText,
          target_text: legoTargetText,
          status: 'draft'
        })

        // Link presentation audio to LEGO
        const presentationText = intro.presentation
        if (presentationText) {
          const presAudio = presentationLookup.get(presentationText)
          if (presAudio) {
            legoIntroductions.push({
              course_code: courseCode,
              lego_id: legoId,
              audio_uuid: presAudio.id,
              duration_ms: Math.round((presAudio.duration || 0) * 1000)
            })
          }
        }

        // Process practice phrases (nodes array)
        let position = 0
        for (const phrase of intro.nodes || []) {
          position++

          const phraseKnownText = phrase.known?.text
          const phraseTargetText = phrase.target?.text

          if (!phraseKnownText || !phraseTargetText) continue

          coursePracticePhrases.push({
            course_code: courseCode,
            seed_number: seedNumber,
            lego_index: legoIndex,
            position: position,
            word_count: phraseTargetText.split(/\s+/).length,
            lego_count: 1, // Number of LEGOs in phrase - default 1
            known_text: phraseKnownText,
            target_text: phraseTargetText,
            status: 'draft'
          })
        }
      }
    }
  }

  // Process audio samples (reuse allSampleSources from presentation lookup)
  for (const samplesObj of allSampleSources) {
    for (const [text, samples] of Object.entries(samplesObj || {})) {
      for (const sample of samples) {
        // Dedup by UUID (same audio might appear multiple times)
        if (!audioSamples.has(sample.id)) {
          audioSamples.set(sample.id, {
            uuid: sample.id,
            text: text,
            text_normalized: normalizeText(text).toLowerCase(),
            lang: sample.role === 'source' ? knownLang : targetLang,
            voice_id: 'legacy',
            cadence: sample.cadence || 'slow',
            role: sample.role,
            source: 'legacy', // TTS source - legacy import
            s3_key: `mastered/${sample.id}.mp3`,
            duration_ms: Math.round((sample.duration || 0) * 1000),
            status: 'approved'
          })
        }
      }
    }
  }

  console.log(`\n📊 Parsed:`)
  console.log(`   Seeds: ${courseSeeds.length}`)
  console.log(`   LEGOs: ${courseLegos.length}`)
  console.log(`   Practice Phrases: ${coursePracticePhrases.length}`)
  console.log(`   LEGO Introductions: ${legoIntroductions.length}`)
  console.log(`   Audio Samples: ${audioSamples.size}`)

  // Insert into database
  console.log(`\n⬆️  Inserting into Supabase...`)

  // 1. Insert course (minimal columns - schema may vary)
  console.log(`   Creating course ${courseCode}...`)
  const { error: courseError } = await supabase
    .from('courses')
    .upsert({
      course_code: courseCode,
      known_lang: knownLang,
      target_lang: targetLang,
      display_name: `${knownLang.toUpperCase()} → ${targetLang.toUpperCase()}`,
      status: 'draft'
    }, { onConflict: 'course_code', ignoreDuplicates: false })

  if (courseError) {
    console.error(`   ❌ ERROR creating course:`, courseError)
    return
  }
  console.log(`   ✓ Course created`)

  // 2. Insert seeds (batch)
  console.log(`   Inserting ${courseSeeds.length} seeds...`)
  const { error: seedsError } = await supabase
    .from('course_seeds')
    .upsert(courseSeeds, { onConflict: 'course_code,seed_number' })

  if (seedsError) {
    console.error(`   ❌ ERROR inserting seeds:`, seedsError)
    return
  }
  console.log(`   ✓ Seeds inserted`)

  // 3. Insert legos (batch)
  console.log(`   Inserting ${courseLegos.length} legos...`)
  const { error: legosError } = await supabase
    .from('course_legos')
    .upsert(courseLegos, { onConflict: 'course_code,seed_number,lego_index' })

  if (legosError) {
    console.error(`   ❌ ERROR inserting legos:`, legosError)
    return
  }
  console.log(`   ✓ LEGOs inserted`)

  // 4. Insert practice phrases (batch, might be large)
  console.log(`   Inserting ${coursePracticePhrases.length} practice phrases...`)
  const PHRASE_CHUNK = 1000
  for (let i = 0; i < coursePracticePhrases.length; i += PHRASE_CHUNK) {
    const chunk = coursePracticePhrases.slice(i, i + PHRASE_CHUNK)
    const { error: phrasesError } = await supabase
      .from('course_practice_phrases')
      .upsert(chunk, { onConflict: 'course_code,seed_number,lego_index,position' })

    if (phrasesError) {
      console.error(`   ❌ ERROR inserting practice phrases:`, phrasesError)
      return
    }
  }
  console.log(`   ✓ Practice phrases inserted`)

  // 5. Insert LEGO introductions (links LEGOs to their presentation audio)
  if (legoIntroductions.length > 0) {
    console.log(`   Inserting ${legoIntroductions.length} LEGO introductions...`)
    const { error: introError } = await supabase
      .from('lego_introductions')
      .upsert(legoIntroductions, { onConflict: 'course_code,lego_id' })

    if (introError) {
      console.error(`   ❌ ERROR inserting LEGO introductions:`, introError)
      // Non-fatal - continue with audio samples
    } else {
      console.log(`   ✓ LEGO introductions inserted`)
    }
  }

  // 6. Insert audio samples (batch, smaller chunks to avoid payload limits)
  const samplesArray = Array.from(audioSamples.values())
  const CHUNK_SIZE = 500
  console.log(`   Inserting ${samplesArray.length} audio samples...`)

  for (let i = 0; i < samplesArray.length; i += CHUNK_SIZE) {
    const chunk = samplesArray.slice(i, i + CHUNK_SIZE)
    const { error: samplesError } = await supabase
      .from('audio_samples')
      .upsert(chunk, { onConflict: 'uuid' })

    if (samplesError) {
      console.error(`   ❌ ERROR inserting audio samples:`, samplesError)
      return
    }
    process.stdout.write(`     ${Math.min(i + CHUNK_SIZE, samplesArray.length)}/${samplesArray.length}\r`)
  }
  console.log(`   ✓ Audio samples inserted        `)

  console.log(`\n✅ Import complete!`)
  console.log(`   Course "${courseCode}" is now available in the database.`)
  console.log(`\n   To play: select this course in the app`)
}

// Main
const manifestPath = process.argv[2]
if (!manifestPath) {
  console.error('Usage: node scripts/import-legacy-manifest.js <manifest.json>')
  console.error('')
  console.error('Example:')
  console.error('  SUPABASE_URL=https://xxx.supabase.co \\')
  console.error('  SUPABASE_SERVICE_KEY=eyJxxx \\')
  console.error('  node scripts/import-legacy-manifest.js ~/Downloads/course_manifest.json')
  process.exit(1)
}

importManifest(manifestPath).catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
