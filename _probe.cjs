#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const COURSE = 'ita_for_eng';

async function main() {
  console.log('\n=== scortese LEGO (declared) ===\n');
  const { data: scortese } = await supabase
    .from('course_legos')
    .select('lego_id, type, target_text, known_text, components')
    .eq('course_code', COURSE)
    .eq('target_text', 'scortese');
  console.log(JSON.stringify(scortese, null, 2));

  console.log('\n=== Practice phrase "she doesn\'t want to seem unfriendly to you" — find it ===\n');
  const { data: pp } = await supabase
    .from('course_practice_phrases')
    .select('seed_number, lego_index, position, target_text, known_text')
    .eq('course_code', COURSE)
    .ilike('known_text', '%doesn%t want to seem%unfriendly%');
  console.log(JSON.stringify(pp, null, 2));
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
