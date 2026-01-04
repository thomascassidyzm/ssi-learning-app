const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')

const envFile = readFileSync('packages/player-vue/.env', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=')
  if (key && val.length) env[key.trim()] = val.join('=').trim()
})

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY)

async function exploreTables() {
  console.log('=== Exploring Supabase Tables ===\n')

  const tableNames = [
    // v13 tables
    'course_audio', 'shared_audio',
    // v12 tables/views
    'texts', 'audio_files', 'audio_registry',
    'practice_cycles', 'lego_cycles', 'lego_introductions',
    'audio_samples',
    // Course structure tables
    'courses', 'course_seeds', 'course_legos', 'course_practice_phrases'
  ]

  for (const table of tableNames) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(2)

    if (!error && data) {
      // Get count
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })

      console.log(`TABLE: ${table} (${count || 0} rows)`)
      if (data.length > 0) {
        console.log(`  Columns: ${Object.keys(data[0]).join(', ')}`)
        console.log(`  Sample row:`, JSON.stringify(data[0], null, 2).split('\n').map(l => '    ' + l).join('\n'))
      } else {
        console.log('  (empty)')
      }
      console.log('')
    } else if (error) {
      console.log(`TABLE: ${table} - ERROR: ${error.message}`)
      console.log('')
    }
  }
}

exploreTables().catch(console.error)
