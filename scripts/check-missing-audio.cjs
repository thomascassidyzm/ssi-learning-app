const { createClient } = require('@supabase/supabase-js')
const { readFileSync } = require('fs')
const envFile = readFileSync('/Users/tomcassidy/SSi/ssi-learning-app/packages/player-vue/.env', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=')
  if (key && val.length) env[key.trim()] = val.join('=').trim()
})
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY)

async function check() {
  // Get ALL distinct known texts from practice phrases
  const { data: phrases } = await supabase
    .from('course_practice_phrases')
    .select('known_text')
    .eq('course_code', 'nld_for_eng')

  const uniqueKnown = new Set(phrases.map(p => p.known_text.toLowerCase().trim()))
  console.log('Unique known texts in phrases:', uniqueKnown.size)

  // Get ALL known audio entries
  const { data: audio } = await supabase
    .from('course_audio')
    .select('text_normalized')
    .eq('course_code', 'nld_for_eng')
    .eq('role', 'known')

  const audioTexts = new Set(audio.map(a => a.text_normalized))
  console.log('Known audio entries in course_audio:', audioTexts.size)

  // Find known texts with no matching audio
  const missing = []
  for (const text of uniqueKnown) {
    if (!audioTexts.has(text)) {
      missing.push(text)
    }
  }
  console.log('Known texts with NO audio:', missing.length)
  console.log('\nMissing:')
  missing.forEach(t => console.log(' ', JSON.stringify(t)))

  // Also check: are there audio entries that DON'T match any phrase?
  let orphanCount = 0
  for (const t of audioTexts) {
    if (!uniqueKnown.has(t)) orphanCount++
  }
  console.log('\nOrphan audio (in course_audio but not in phrases):', orphanCount)
}
check().catch(console.error)
