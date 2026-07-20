import { createClient } from '@supabase/supabase-js'
const BASE = process.env.BASE_URL || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const svc = createClient((process.env.VITE_SUPABASE_URL||'').trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim())
const anon = createClient((process.env.VITE_SUPABASE_URL||'').trim(), (process.env.VITE_SUPABASE_ANON_KEY||'').trim(), { auth: { persistSession: false } })
const { data } = await svc.auth.admin.generateLink({ type: 'magiclink', email: 'thomas.cassidy+admin001@gmail.com' })
const { data: v } = await anon.auth.verifyOtp({ type: 'email', token_hash: data.properties.hashed_token })
const resp = await fetch(`${BASE}/api/groups/d01926e1-b1f4-4e3f-bae5-f03f2dbe15c9/invites`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.session.access_token}` },
  body: JSON.stringify({ role: 'teacher', limits: {}, personal: { name: 'Deploy Probe' } }),
})
const body = await resp.json()
// Old builds ignore `personal` and 201 a plain open link (no account field) —
// only account.auth_user_id proves the new provisioning path is live.
const ready = resp.ok && !!body.account?.auth_user_id
// cleanup whatever was minted either way
if (body.code) await svc.from('invite_codes').delete().eq('code', body.code)
if (body.account?.auth_user_id) {
  await svc.from('user_tags').delete().eq('user_id', body.account.auth_user_id)
  await svc.from('learners').delete().eq('user_id', body.account.auth_user_id)
  await svc.auth.admin.deleteUser(body.account.auth_user_id)
}
if (!ready) { console.error('not ready:', resp.status, body.error || '(no account in response)'); process.exit(1) }
console.log('READY — personal mint works on deployed build')
