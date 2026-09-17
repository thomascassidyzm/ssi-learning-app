// The abandoned-detour rule: node --test docs/specimens/replaying-brain/detourRule.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findAbandonedDetours } from './detourRule.mjs'

const seedOf = id => Number(id.slice(1, 5))            // S0002L02 -> 2
const play = (t, lego_id) => ({ occurred_at: t, lego_id })
const at = s => `2026-01-01T1${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000+00:00`

test('a chunk the class was skipped back off within the window is not the first light', () => {
  const plays = [play(at(0), 'S0002L02'), play(at(17), 'S0002L02'), play(at(78), 'S0001L01'), play(at(99), 'S0001L01')]
  const jumps = [{ occurred_at: at(45), target_seed: 1 }]
  const detoured = findAbandonedDetours(plays, jumps, seedOf)
  assert.equal(detoured.size, 2)
  const kept = plays.filter(p => !detoured.has(p))
  assert.equal(kept[0].lego_id, 'S0001L01', 'the first light is the chunk the class stayed with')
})

test('a chunk the class stayed with is kept, even when a later skip goes back past it', () => {
  // Same shape, but the class worked on S0002L02 for five minutes before the skip.
  const plays = [play(at(0), 'S0002L02'), play(at(300), 'S0002L02')]
  const jumps = [{ occurred_at: at(340), target_seed: 1 }]
  const detoured = findAbandonedDetours(plays, jumps, seedOf)
  assert.equal(detoured.size, 1, 'only the play inside the window is abandoned')
  assert.ok(!detoured.has(plays[0]), 'the earlier play stuck and stays lit')
})

test('a forward jump, and a jump to where the class already is, abandon nothing', () => {
  const plays = [play(at(0), 'S0001L01'), play(at(20), 'S0001L01')]
  assert.equal(findAbandonedDetours(plays, [{ occurred_at: at(30), target_seed: 4 }], seedOf).size, 0)
  assert.equal(findAbandonedDetours(plays, [{ occurred_at: at(30), target_seed: 1 }], seedOf).size, 0)
  assert.equal(findAbandonedDetours(plays, [{ occurred_at: at(30), target_seed: null }], seedOf).size, 0)
})

test('the window is a parameter, not a constant in the rule', () => {
  const plays = [play(at(0), 'S0002L02')]
  const jumps = [{ occurred_at: at(90), target_seed: 1 }]
  assert.equal(findAbandonedDetours(plays, jumps, seedOf).size, 0)
  assert.equal(findAbandonedDetours(plays, jumps, seedOf, 120_000).size, 1)
})

test('a long run under the gap window is still real practice, not an abandoned detour', () => {
  // 11 plays 30s apart over 5 minutes (each gap well under the 60s window), then a skip back.
  const plays = Array.from({ length: 11 }, (_, n) => play(at(n * 30), 'S0002L02'))
  const jumps = [{ occurred_at: at(340), target_seed: 1 }]
  assert.equal(findAbandonedDetours(plays, jumps, seedOf).size, 0, 'a five-minute run is not abandoned within about a minute')
})
