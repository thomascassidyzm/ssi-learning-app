#!/usr/bin/env node
/**
 * Reset Learner Progress
 *
 * Clears all progress for a learner (or all learners) for testing.
 *
 * Usage:
 *   node scripts/reset-learner-progress.js [learner_id] [course_code]
 *
 * Examples:
 *   node scripts/reset-learner-progress.js                    # Reset ALL progress (dangerous!)
 *   node scripts/reset-learner-progress.js user_123           # Reset all progress for user_123
 *   node scripts/reset-learner-progress.js user_123 en-es     # Reset user_123's en-es progress only
 */

const { createClient } = require('@supabase/supabase-js')
const { resolve } = require('path')

// Load env
try {
  require('dotenv').config({ path: resolve(__dirname, '../.env') })
} catch (e) {}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function resetProgress(learnerId, courseCode) {
  console.log('\n🔄 Resetting learner progress...')
  console.log(`   Learner: ${learnerId || 'ALL'}`)
  console.log(`   Course: ${courseCode || 'ALL'}`)

  // Build filters
  const filters = {}
  if (learnerId) filters.learner_id = learnerId
  if (courseCode) filters.course_id = courseCode

  // Tables to clear (in order due to FK constraints)
  const tables = [
    'response_metrics',
    'spike_events',
    'lego_progress',
    'seed_progress',
    'sessions',
  ]

  for (const table of tables) {
    let query = supabase.from(table).delete()

    // Apply filters
    if (learnerId) {
      query = query.eq('learner_id', learnerId)
    } else {
      // Need a condition for delete - use neq with impossible value
      query = query.neq('learner_id', '___impossible___')
    }

    if (courseCode) {
      query = query.eq('course_id', courseCode)
    }

    const { error, count } = await query.select('*', { count: 'exact', head: true })

    // Actually delete
    let deleteQuery = supabase.from(table).delete()
    if (learnerId) deleteQuery = deleteQuery.eq('learner_id', learnerId)
    else deleteQuery = deleteQuery.neq('learner_id', '___impossible___')
    if (courseCode) deleteQuery = deleteQuery.eq('course_id', courseCode)

    const { error: delError } = await deleteQuery

    if (delError) {
      console.log(`   ⚠️  ${table}: ${delError.message}`)
    } else {
      console.log(`   ✓ ${table} cleared`)
    }
  }

  // Reset enrollment stats (don't delete, just reset)
  if (learnerId || courseCode) {
    let enrollQuery = supabase
      .from('course_enrollments')
      .update({
        total_practice_minutes: 0,
        last_practiced_at: null,
        welcome_played: false,  // Reset welcome status
      })

    if (learnerId) enrollQuery = enrollQuery.eq('learner_id', learnerId)
    if (courseCode) enrollQuery = enrollQuery.eq('course_id', courseCode)

    const { error: enrollError } = await enrollQuery

    if (enrollError) {
      console.log(`   ⚠️  course_enrollments: ${enrollError.message}`)
    } else {
      console.log(`   ✓ course_enrollments reset`)
    }
  }

  console.log('\n✅ Progress reset complete!')
}

// Parse args
const learnerId = process.argv[2] || null
const courseCode = process.argv[3] || null

// Safety check for full reset
if (!learnerId && !courseCode) {
  console.log('\n⚠️  WARNING: This will reset ALL learner progress!')
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')
  setTimeout(() => {
    resetProgress(learnerId, courseCode).catch(console.error)
  }, 5000)
} else {
  resetProgress(learnerId, courseCode).catch(console.error)
}
