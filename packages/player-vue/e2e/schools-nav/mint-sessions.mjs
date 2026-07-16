// Mint real Supabase sessions for the three schools test personas.
// Uses admin.generateLink (NO email is ever sent) + verifyOtp with the
// public anon key to produce ordinary browser sessions, saved to
// repro/sessions.json for the Playwright harness to inject.
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
if (!SERVICE || !ANON) throw new Error('missing keys in env')

const admin = createClient(URL, SERVICE)

const PERSONAS = {
  school_admin: 'thomas.cassidy+ang_school_admin@gmail.com',
  teacher: 'thomas.cassidy+ang_school_teacher@gmail.com',
  govt_admin: 'thomas.cassidy+govtest@gmail.com',
}

const out = {}
for (const [role, email] of Object.entries(PERSONAS)) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`${role}: generateLink failed: ${error.message}`)
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: v, error: verr } = await anon.auth.verifyOtp({
    type: 'email',
    token_hash: data.properties.hashed_token,
  })
  if (verr) throw new Error(`${role}: verifyOtp failed: ${verr.message}`)
  out[role] = v.session
  console.log(`${role}: session ok (user ${v.session.user.id})`)
}

writeFileSync(new globalThis.URL('./sessions.json', import.meta.url), JSON.stringify(out, null, 1))
console.log('wrote repro/sessions.json')
