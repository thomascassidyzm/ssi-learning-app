// Drift-gate unit tests for the walkthrough compiler (tools/walkthrough/lib.mjs)
// — fixture-level checks of each gate, plus one live run of the real CLI in
// --check mode so the whole pack is validated on every `pnpm test` (this is
// what makes "a broken anchor fails the build" true in CI without a new step).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
// Plain .mjs module, no types — shape is asserted by these tests.
import {
  validateWalkSchema,
  gateAnchors,
  gatePlaces,
  gateOffers,
  gateSafety,
  runGates,
} from '../../../../tools/walkthrough/lib.mjs'

const walk = (over: Record<string, unknown> = {}) => ({
  id: 'test-walk',
  title: 'Test walk',
  personas: ['admin'],
  place: { route: 'node-home' },
  steps: [{ anchor: 'verb-invite-person', say: 'Tap it.', advance: { on: 'next' } }],
  ...over,
})

const RUNTIME_SRC = "export const KNOWN_PLACES = ['node-home', 'class-detail', 'node-insights', 'admin-invites']"
const EVAL_SRC = "const walkId = rule.cta.target.startsWith('walk:') ? rule.cta.target.slice(5) : undefined"

describe('validateWalkSchema', () => {
  it('accepts a well-formed walk', () => {
    expect(validateWalkSchema(walk())).toEqual([])
  })
  it('rejects unknown personas, bad advance kinds, empty steps', () => {
    expect(validateWalkSchema(walk({ personas: ['pupil'] }))).toHaveLength(1)
    expect(validateWalkSchema(walk({ steps: [] }))).toHaveLength(1)
    expect(validateWalkSchema(walk({ steps: [{ anchor: 'a', say: 'x', advance: { on: 'timer' } }] }))).toHaveLength(1)
  })
  it('rejects terminal on a non-final step', () => {
    const errs = validateWalkSchema(walk({
      steps: [
        { anchor: 'a-one', say: 'x', advance: { on: 'next' }, terminal: 'done' },
        { anchor: 'a-two', say: 'y', advance: { on: 'next' } },
      ],
    }))
    expect(errs.some((e: string) => e.includes('terminal'))).toBe(true)
  })
})

describe('gateAnchors', () => {
  const vue = (src: string) => [{ path: 'src/Fake.vue', src }]

  it('fails when a step anchor has no data-walk in any source', () => {
    const { failures } = gateAnchors([walk()], vue('<button>plain</button>'))
    expect(failures.some((f: string) => f.includes('verb-invite-person'))).toBe(true)
  })
  it('passes when the anchor exists', () => {
    const { failures } = gateAnchors([walk()], vue('<button data-walk="verb-invite-person">Go</button>'))
    expect(failures).toEqual([])
  })
  it('FAILS a member-persona walk whose anchor is admin-only (v-if="!member")', () => {
    const { failures } = gateAnchors(
      [walk({ personas: ['leader'] })],
      vue('<button v-if="!member" data-walk="verb-invite-person">Go</button>'),
    )
    expect(failures.some((f: string) => f.includes('PERSONA'))).toBe(true)
  })
  it('allows an admin-only walk on an admin-only anchor', () => {
    const { failures } = gateAnchors(
      [walk({ personas: ['admin'] })],
      vue('<button v-if="!member" data-walk="verb-invite-person">Go</button>'),
    )
    expect(failures).toEqual([])
  })
  it('warns on orphan anchors', () => {
    const { warnings } = gateAnchors([walk()], vue(
      '<b data-walk="verb-invite-person">x</b><i data-walk="never-used">y</i>',
    ))
    expect(warnings.some((w: string) => w.includes('never-used'))).toBe(true)
  })
})

describe('gatePlaces', () => {
  it('fails an unknown place and reports the known list', () => {
    const { failures } = gatePlaces([walk({ place: { route: 'moon-base' } })], RUNTIME_SRC)
    expect(failures.some((f: string) => f.includes('moon-base'))).toBe(true)
  })
  it('fails when the runtime no longer declares KNOWN_PLACES', () => {
    const { failures } = gatePlaces([walk()], 'export const nothing = 1')
    expect(failures).toHaveLength(1)
  })
})

describe('gateOffers', () => {
  it('fails a rules.json walk: CTA that names no walk in the pack', () => {
    const rules = { rules: [{ id: 'r1', cta: { target: 'walk:ghost-walk' } }] }
    const { failures } = gateOffers([walk()], rules, EVAL_SRC)
    expect(failures.some((f: string) => f.includes('ghost-walk'))).toBe(true)
  })
  it('fails when evaluateRules.ts drops the walk: prefix handling', () => {
    const { failures } = gateOffers([walk()], { rules: [] }, 'no prefix here')
    expect(failures.some((f: string) => f.includes('LOCKSTEP'))).toBe(true)
  })
})

describe('gateSafety (destructive-verb denylist)', () => {
  it('FAILS a click-advance step on a destructive anchor', () => {
    const bad = walk({ steps: [{ anchor: 'verb-delete', say: 'x', advance: { on: 'click' } }] })
    const { failures } = gateSafety([bad])
    expect(failures.some((f: string) => f.includes('SAFETY'))).toBe(true)
  })
  it('allows POINTING at a destructive anchor (advance: next)', () => {
    const ok = walk({ steps: [{ anchor: 'verb-delete', say: 'x', advance: { on: 'next' } }] })
    expect(gateSafety([ok]).failures).toEqual([])
  })
  it('blocks click steps on submit/re-mint/toggle style anchors too', () => {
    for (const anchor of ['invite-form-submit', 'ways-in-remint', 'invites-active-toggle', 'class-play']) {
      const bad = walk({ steps: [{ anchor, say: 'x', advance: { on: 'click' } }] })
      expect(gateSafety([bad]).failures, anchor).toHaveLength(1)
    }
  })
})

describe('runGates (composed)', () => {
  it('accumulates failures across gates instead of stopping at the first', () => {
    const bad = walk({
      personas: ['leader'],
      place: { route: 'moon-base' },
      steps: [{ anchor: 'verb-delete', say: 'x', advance: { on: 'click' } }],
    })
    const { failures } = runGates({
      walks: [bad],
      vueFiles: [{ path: 'f.vue', src: '<div />' }],
      runtimeSrc: RUNTIME_SRC,
      rulesJson: { rules: [] },
      evaluateRulesSrc: EVAL_SRC,
    })
    expect(failures.length).toBeGreaterThanOrEqual(3) // anchor + place + safety
  })
})

describe('the real pack (live drift gate)', () => {
  it('tools/walkthrough/compile.mjs --check passes against the current source', () => {
    // vitest runs with cwd = packages/player-vue; the CLI lives at repo root.
    const cli = join(process.cwd(), '..', '..', 'tools', 'walkthrough', 'compile.mjs')
    const res = spawnSync(process.execPath, [cli, '--check'], { encoding: 'utf8' })
    expect(res.status, res.stderr || res.stdout).toBe(0)
  })
})
