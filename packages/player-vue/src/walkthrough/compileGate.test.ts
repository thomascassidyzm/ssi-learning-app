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
  gateNoAutoPlay,
  gateRuntimeDenylist,
  validateHandbookBlock,
  gateSections,
  gateRoleBadges,
  gatePlaceLinks,
  isHandbookEntry,
  DESTRUCTIVE_ANCHOR_PATTERNS,
  HANDBOOK_SECTIONS,
  PERSONAS,
  runGates,
} from '../../../../tools/walkthrough/lib.mjs'
import { readFileSync } from 'node:fs'

// Every non-learner entry now carries its handbook block and section — the
// Handbook page's completeness claim (2026-09-07) is a schema rule, so the
// baseline fixture states it rather than the old tests being exempted from it.
const walk = (over: Record<string, unknown> = {}) => ({
  id: 'test-walk',
  title: 'Test walk',
  section: 'getting-people-in',
  personas: ['admin'],
  place: { route: 'node-home' },
  handbook: { what: 'What it is for.', where: 'The node home page.', how: ['Tap it.'] },
  steps: [{ anchor: 'verb-invite-person', say: 'Tap it.', advance: { on: 'next' } }],
  ...over,
})

const RUNTIME_SRC = [
  "export const KNOWN_PLACES = ['node-home', 'class-detail', 'node-insights', 'admin-invites', 'library']",
  `export const DESTRUCTIVE_ANCHOR_PATTERNS = [${DESTRUCTIVE_ANCHOR_PATTERNS.map((re: RegExp) => re.toString()).join(', ')}]`,
].join('\n')
const EVAL_SRC = "const walkId = rule.cta.target.startsWith('walk:') ? rule.cta.target.slice(5) : undefined"

describe('validateWalkSchema', () => {
  it('accepts a well-formed walk', () => {
    expect(validateWalkSchema(walk())).toEqual([])
  })
  it('rejects unknown personas, bad advance kinds, empty steps', () => {
    expect(validateWalkSchema(walk({ personas: ['pupil'] }))).toHaveLength(1)  // unknown persona
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
  // A-159 hub: topic is the chip label, keywords are the search vocabulary.
  // Both optional (every pre-hub walk stays valid), both policed when present —
  // a blank chip or an upper-case keyword is a door that lies or never opens.
  it('accepts a walk with a topic and keywords', () => {
    expect(validateWalkSchema(walk({ topic: 'Where you are', keywords: ['belt', 'how far'] }))).toEqual([])
  })
  it('rejects a blank topic and non-lower-case or empty keywords', () => {
    expect(validateWalkSchema(walk({ topic: '   ' }))).toHaveLength(1)
    expect(validateWalkSchema(walk({ keywords: 'belt' }))).toHaveLength(1)
    expect(validateWalkSchema(walk({ keywords: ['Belt'] }))).toHaveLength(1)
    expect(validateWalkSchema(walk({ keywords: [''] }))).toHaveLength(1)
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
  // A-159: the learner persona is the furthest thing from an admin, so gate 2
  // must police it exactly like the other member personas.
  it('FAILS a learner walk whose anchor is admin-only (v-if="!member")', () => {
    const { failures } = gateAnchors(
      [walk({ personas: ['learner'] })],
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

describe('gateNoAutoPlay (never-auto-play, structurally)', () => {
  it('passes when every startWalk call sits inside an @click handler', () => {
    const src = `<script setup>import { startWalk } from '@/walkthrough/useWalkthrough'</script>
<template><button @click="startWalk(w.id)">Show me</button></template>`
    expect(gateNoAutoPlay([{ path: 'src/Ok.vue', src }]).failures).toEqual([])
  })
  it('FAILS a script-block startWalk call (mounted-hook / autostart shape)', () => {
    const src = `<script setup>import { startWalk } from '@/walkthrough/useWalkthrough'
onMounted(() => startWalk('invite-first-teacher'))</script>
<template><div /></template>`
    const { failures } = gateNoAutoPlay([{ path: 'src/Bad.vue', src }])
    expect(failures.some((f: string) => f.includes('AUTOPLAY'))).toBe(true)
  })
  it('ignores files that only import without calling', () => {
    const src = `<script setup>import { walksFor } from '@/walkthrough/useWalkthrough'</script>`
    expect(gateNoAutoPlay([{ path: 'src/NoCall.vue', src }]).failures).toEqual([])
  })
})

describe('gateRuntimeDenylist (runtime safety mirror lockstep)', () => {
  it('passes when the runtime mirrors every build-time pattern', () => {
    expect(gateRuntimeDenylist(RUNTIME_SRC).failures).toEqual([])
  })
  it('fails when the runtime list drops a pattern', () => {
    const dropped = RUNTIME_SRC.replace('/delete/i, ', '')
    const { failures } = gateRuntimeDenylist(dropped)
    expect(failures.some((f: string) => f.includes('/delete/i'))).toBe(true)
  })
  it('fails when the runtime mirror is gone entirely', () => {
    const { failures } = gateRuntimeDenylist('export const nothing = 1')
    expect(failures).toHaveLength(1)
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


// ---------------------------------------------------------------------------
// HANDBOOK (2026-09-07). The page's whole claim is that it is the complete,
// never-stale map — so a capability with no prose, a section only one side
// knows about, or a role with no badge are all build failures.
// ---------------------------------------------------------------------------

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'test-entry',
  title: 'Test entry',
  section: 'getting-people-in',
  personas: ['teacher'],
  place: { route: 'teachers' },
  anchor: 'teacher-signin-link',
  handbook: {
    what: 'What it is for.',
    where: 'The Teachers page.',
    how: ['Open Teachers.', 'Tap the row.'],
  },
  ...over,
})

// happy-dom breaks fileURLToPath(import.meta.url) under vitest, so these
// anchor on the runner's cwd (packages/player-vue) like the live-CLI test below.
const HANDBOOK_SRC = readFileSync(join(process.cwd(), 'src/walkthrough/handbook.ts'), 'utf8')
const REAL_RUNTIME_SRC = readFileSync(join(process.cwd(), 'src/walkthrough/useWalkthrough.ts'), 'utf8')

describe('validateHandbookBlock', () => {
  it('accepts a well-formed prose-only entry', () => {
    expect(validateHandbookBlock(entry())).toEqual([])
  })
  it('FAILS a non-learner entry with no handbook block — a hole in the page', () => {
    const errs = validateHandbookBlock(entry({ handbook: undefined }))
    expect(errs.some((e: string) => e.includes('handbook block is required'))).toBe(true)
  })
  it('fails an unknown section', () => {
    const errs = validateHandbookBlock(entry({ section: 'making-tea' }))
    expect(errs.some((e: string) => e.includes('making-tea'))).toBe(true)
  })
  it('fails empty what / where / how', () => {
    expect(validateHandbookBlock(entry({ handbook: { what: ' ', where: 'x', how: ['y'] } }))).toHaveLength(1)
    expect(validateHandbookBlock(entry({ handbook: { what: 'x', where: '', how: ['y'] } }))).toHaveLength(1)
    expect(validateHandbookBlock(entry({ handbook: { what: 'x', where: 'y', how: [] } }))).toHaveLength(1)
  })
  // Zero-explanation ruling: the product explains by example, never in an aside.
  it('fails prose carrying parentheses', () => {
    const errs = validateHandbookBlock(entry({
      handbook: { what: 'A link (their login).', where: 'x', how: ['y'] },
    }))
    expect(errs.some((e: string) => e.includes('parentheses'))).toBe(true)
  })
  it('exempts learner-only entries, which belong to the learner hub', () => {
    expect(isHandbookEntry({ personas: ['learner'] })).toBe(false)
    expect(validateHandbookBlock({ id: 'l', personas: ['learner'] })).toEqual([])
  })
})

describe('validateWalkSchema with handbook entries', () => {
  it('accepts an entry with no steps but an anchor', () => {
    expect(validateWalkSchema(entry())).toEqual([])
  })
  it('fails an entry with neither steps nor an anchor', () => {
    const errs = validateWalkSchema(entry({ anchor: undefined }))
    expect(errs.some((e: string) => e.includes('no steps'))).toBe(true)
  })
})

describe('gateAnchors covers a prose-only entry', () => {
  it('FAILS when the entry anchor is gone from the source — the deleted-button case', () => {
    const { failures } = gateAnchors([entry()], [{ path: 'f.vue', src: '<div />' }])
    expect(failures.some((f: string) => f.includes('teacher-signin-link'))).toBe(true)
  })
  it('passes when the anchor is live', () => {
    const { failures } = gateAnchors(
      [entry()],
      [{ path: 'f.vue', src: '<button data-walk="teacher-signin-link">Access code</button>' }],
    )
    expect(failures).toEqual([])
  })
})

describe('gateSections (lockstep with the runtime section list)', () => {
  it('passes against the real handbook.ts', () => {
    expect(gateSections(HANDBOOK_SRC).failures).toEqual([])
  })
  it('fails when the runtime drops a section the compiler knows', () => {
    const dropped = HANDBOOK_SRC.replace(/\{ id: 'your-school'[^}]*\},\n/, '')
    expect(gateSections(dropped).failures.some((f: string) => f.includes('your-school'))).toBe(true)
  })
  it('fails when the runtime declares a section the compiler has never heard of', () => {
    const extra = HANDBOOK_SRC.replace(
      "{ id: 'your-school', title: 'Your school' },",
      "{ id: 'your-school', title: 'Your school' },\n  { id: 'making-tea', title: 'Making tea' },",
    )
    expect(gateSections(extra).failures.some((f: string) => f.includes('making-tea'))).toBe(true)
  })
})

describe('gateRoleBadges (whose capability is it)', () => {
  it('passes against the real runtime and handbook', () => {
    expect(gateRoleBadges(REAL_RUNTIME_SRC, HANDBOOK_SRC).failures).toEqual([])
  })
  it('FAILS when a persona has no badge label — an unbadged capability', () => {
    const dropped = HANDBOOK_SRC.replace(/\n\s*teacher: 'Teacher',/, '')
    expect(gateRoleBadges(REAL_RUNTIME_SRC, dropped).failures.some((f: string) => f.includes('teacher'))).toBe(true)
  })
  it('fails when the WalkPersona union and the compiler disagree', () => {
    const renamed = REAL_RUNTIME_SRC.replace("'school_admin'", "'head_teacher'")
    const { failures } = gateRoleBadges(renamed, HANDBOOK_SRC)
    expect(failures.some((f: string) => f.includes('school_admin'))).toBe(true)
    expect(failures.some((f: string) => f.includes('head_teacher'))).toBe(true)
  })
  it('knows every persona the compiler declares', () => {
    expect(PERSONAS.length).toBeGreaterThan(0)
    expect(HANDBOOK_SECTIONS.length).toBe(6)
  })
})

describe('gatePlaceLinks (every place has somewhere to go)', () => {
  it('passes against the real runtime and handbook', () => {
    expect(gatePlaceLinks(REAL_RUNTIME_SRC, HANDBOOK_SRC).failures).toEqual([])
  })
  it('fails when the runtime learns a place the page cannot link to', () => {
    const extra = REAL_RUNTIME_SRC.replace("'library',", "'library', 'moon-base',")
    expect(gatePlaceLinks(extra, HANDBOOK_SRC).failures.some((f: string) => f.includes('moon-base'))).toBe(true)
  })
})
