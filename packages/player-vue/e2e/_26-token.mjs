import { createClient } from '@supabase/supabase-js'
const URL = process.env.SB_URL, SVC = process.env.SVC, ANON = process.env.ANON
const svc = createClient(URL, SVC)
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
if (error) throw error
const { data: v, error: verr } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
if (verr) throw verr
if (process.argv[2] === 'session') console.log(JSON.stringify(v.session)); else console.log(v.session.access_token)
