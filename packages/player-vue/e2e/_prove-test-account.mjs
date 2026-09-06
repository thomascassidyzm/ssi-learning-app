// PROOF for the 2026-09-06 fix: the journey harness can no longer hold a
// session as a real person, and the account it does use is a different user.
// Read-only against Tom's row: it is snapshotted before and after and must be
// byte-identical.
import { mintSession, ensureTestLearner, svc, TEST_LEARNER } from './journeys/lib.mjs'
import { PROTECTED_ACCOUNTS } from './_test-accounts.mjs'

const TOM = 'thomas.cassidy+ssi@gmail.com'
const s = svc()
const snap = async () => {
  const { data } = await s.from('learners').select('id,updated_at,preferences')
    .eq('user_id', 'ef65ea1f-57d0-4cf4-b744-33870c9449e8').single()
  return JSON.stringify(data)
}
const before = await snap()
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

check('Tom is in the protected register', PROTECTED_ACCOUNTS.has(TOM))
check('the default tester is not Tom', TEST_LEARNER !== TOM, TEST_LEARNER)

try {
  await mintSession(TOM)
  check('mintSession REFUSES Tom', false, 'it minted a session — the guard did not fire')
} catch (e) {
  check('mintSession REFUSES Tom', /REFUSING to sign in/.test(e.message), e.message.split('\n')[0])
}

await ensureTestLearner()
const sess = await mintSession(TEST_LEARNER)
const { data: u } = await s.auth.admin.getUserById(sess.user.id)
check('mintSession works for the test learner', !!sess.access_token)
check('the minted session is a different user', sess.user.id !== 'ef65ea1f-57d0-4cf4-b744-33870c9449e8',
  `${u.user.email} = ${sess.user.id}`)

const after = await snap()
check("Tom's learner row is untouched by this proof", before === after)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
