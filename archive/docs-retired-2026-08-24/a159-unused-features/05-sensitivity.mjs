// Sensitivity check: does excluding the two platform_role='popty_user' accounts
// (SSi content-team, not paying learners) move any adoption figure?
import fs from 'node:fs'
const d = new URL('.', import.meta.url).pathname
const J = n => JSON.parse(fs.readFileSync(d + n))
const L = J('_cache-learners.json'), pop = J('_out-population.json')
const by = new Map(L.map(l => [l.id, l]))
const A = pop.active_ids
const B = A.filter(i => by.get(i)?.platform_role !== 'popty_user')
console.log('active strict:', A.length, '| excluding popty_user:', B.length)
const setA = new Set(A), setB = new Set(B)
const seen = new Map()
for (const line of fs.readFileSync(d + '_cache-events.jsonl', 'utf8').split('\n')) {
  if (!line) continue
  const e = JSON.parse(line); const l = e.learner_id || e.user_id
  if (!l || !setA.has(l)) continue
  let s = seen.get(e.event_type); if (!s) { s = new Set(); seen.set(e.event_type, s) }
  s.add(l)
}
for (const [t, s] of [...seen].sort()) {
  const a = s.size, b = [...s].filter(i => setB.has(i)).length
  if (a !== b) console.log(`${t}: ${a} -> ${b}`)
}
