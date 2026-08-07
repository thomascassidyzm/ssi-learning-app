/**
 * The OTHER direction, on production: a leader renames a school from the org
 * tree (PATCH /api/groups/:id on the school's own node) — does the school
 * RECORD follow? And does a rename the duplicate-name warning stopped leave
 * both rows untouched?
 *
 * THROWAWAY ONLY — disposable rows, torn down at the end, no email, no payment.
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_URL || 'https://saysomethingin.app'
const svc = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim(), { auth: { persistSession: false } })
const anon = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_ANON_KEY.trim(), { auth: { persistSession: false } })

const STAMP = String(Date.now()).slice(-6)
const EMAIL = `thomas.cassidy+zz.tree.${STAMP}@gmail.com`
const PASSWORD = 'SsiTest2026!'
const made = { user: null, learner: null, org: null, node: null, school: null, twin: null }

try {
  const { data: created } = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  made.user = created.user.id
  const { data: learner } = await svc.from('learners').select('id').eq('user_id', made.user).single()
  made.learner = learner?.id ?? null

  const { data: org } = await svc.from('groups').insert({ name: `ZZ Tree org ${STAMP} (delete me)`, type: 'region', is_test: true }).select('id').single()
  made.org = org.id
  const { data: node } = await svc.from('groups').insert({ name: 'ZZ Tree school OLD (delete me)', type: 'school', parent_id: org.id, is_test: true }).select('id').single()
  made.node = node.id
  // a same-slug sibling, so the duplicate-name warning has something to fire on
  const { data: twin } = await svc.from('groups').insert({ name: 'ZZ Tree twin (delete me)', type: 'school', parent_id: org.id, is_test: true }).select('id').single()
  made.twin = twin.id
  const { data: school } = await svc.from('schools').insert({
    school_name: 'ZZ Tree school OLD (delete me)', node_group_id: node.id, group_id: org.id, is_test: true,
  }).select('id').single()
  made.school = school.id
  const { error: gaErr } = await svc.from('govt_admins').insert({ user_id: made.user, group_id: org.id, organization_name: `ZZ Tree org ${STAMP}`, created_by: made.user })
  if (gaErr) throw new Error('govt_admins insert failed: ' + gaErr.message)
  const { data: gaCheck } = await svc.from('govt_admins').select('user_id, group_id').eq('user_id', made.user).maybeSingle()
  console.log('leader row:', JSON.stringify(gaCheck))
  const { data: nodeCheck } = await svc.from('groups').select('id, parent_id, path').eq('id', made.node).single()
  console.log('node:', JSON.stringify(nodeCheck))

  const { data: sess } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  const token = sess.session.access_token
  const patch = (body) => fetch(`${BASE}/api/groups/${made.node}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const read = async () => ({
    node: (await svc.from('groups').select('name').eq('id', made.node).single()).data?.name,
    school: (await svc.from('schools').select('school_name').eq('id', made.school).single()).data?.school_name,
  })

  // 1. a rename the duplicate warning stops must write NEITHER row
  const warned = await patch({ name: 'ZZ Tree twin (delete me)' })
  const afterWarn = await read()
  console.log(`warned rename → HTTP ${warned.status} (expect 409)`)
  console.log(`   node   = "${afterWarn.node}"`)
  console.log(`   school = "${afterWarn.school}"`)
  console.log(warned.status === 409 && afterWarn.node.includes('OLD') && afterWarn.school.includes('OLD')
    ? '   pass — the warning still stops both rows\n'
    : '   FAIL — the warning was bypassed\n')

  // 2. a real rename must carry onto the school record
  const NEW = `ZZ Tree school NEW ${STAMP} (delete me)`
  const ok = await patch({ name: NEW })
  const after = await read()
  console.log(`real rename → HTTP ${ok.status} (expect 200)`)
  console.log(`   node   = "${after.node}"`)
  console.log(`   school = "${after.school}"`)
  console.log(after.node === NEW && after.school === NEW
    ? '   pass — one name, both homes'
    : '   FAIL — the school record kept the old name')
} catch (e) {
  console.log('probe error:', e.message)
} finally {
  if (made.user) await svc.from('govt_admins').delete().eq('user_id', made.user)
  if (made.school) await svc.from('schools').delete().eq('id', made.school)
  for (const g of [made.node, made.twin, made.org]) if (g) await svc.from('groups').delete().eq('id', g)
  if (made.learner) await svc.from('learners').delete().eq('id', made.learner)
  if (made.user) await svc.auth.admin.deleteUser(made.user)
  console.log('throwaway rows torn down.')
}
