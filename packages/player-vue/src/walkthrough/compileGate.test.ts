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
  validateHandbookEntry,
  gateHandbookCoverage,
  gateHandbookFreshness,
  gateWalkFreshness,
  indexAnchors,
  assemblePack,
  ANCHOR_ATTRS,
  gateSections,
  gateRoleBadges,
  gatePlaceLinks,
  DESTRUCTIVE_ANCHOR_PATTERNS,
  HANDBOOK_SECTIONS,
  PERSONAS,
  runGates,
  comparePack,
} from '../../../../tools/walkthrough/lib.mjs'
import {
  parseHandbookBlocks, fingerprintCapability, stampChecked, declarationSource,
  proseFingerprint, checkedCode, checkedProse, anchorFingerprint, stepProseFingerprint,
} from '../../../../tools/walkthrough/handbookSource.mjs'
import { readFileSync } from 'node:fs'

// A walk is a CLIP and nothing else since 2026-09-07 — the prose moved into
// the .vue source, beside the capability it describes.
const walk = (over: Record<string, unknown> = {}) => ({
  id: 'test-walk',
  title: 'Test walk',
  personas: ['admin'],
  place: { route: 'node-home' },
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
  // The old orphan WARNING is gone deliberately: an anchor nothing describes
  // and nothing walks is now a build FAILURE in gateHandbookCoverage, which
  // is the stronger statement, and repeating it here would only be noise.
  it('no longer warns about orphan anchors — coverage fails them instead', () => {
    const { warnings } = gateAnchors([walk()], vue(
      '<b data-walk="verb-invite-person">x</b><i data-walk="never-used">y</i>',
    ))
    expect(warnings).toEqual([])
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
// THE HANDBOOK (Tom, 2026-09-07). The prose lives in an HTML comment directly
// above the element it describes, so the agent changing behaviour is already
// looking at the sentence. These tests hold the three properties that makes
// possible: every capability HAS a description, the description is PINNED to
// what it describes, and the repair is one step.
// ---------------------------------------------------------------------------

const BLOCK = `
  <!-- HANDBOOK Bring your first teacher in
       section: getting-people-in
       roles: admin, leader, school_admin
       place: node-home
       keywords: teacher, invite
       What it's for. Getting a colleague into the school with a teacher's
       view, without them signing up for anything.
       Where it is. Your school's home page, **Invite a person**.
       How you do it.
       1. Open your school's home page.
       2. Tap **Invite a person**.
       Worth knowing. The link IS their login.
  -->
  <button v-if="canInvite" data-walk="verb-invite-person" @click="invite('teacher')">Invite a person</button>
`
const SFC = `<script setup lang="ts">
function invite(role: string) { open.value = role }
const canInvite = computed(() => isSchoolAdmin.value)
</script>
<template>${BLOCK}</template>`

describe('parseHandbookBlocks (the prose, read out of the code)', () => {
  it('reads a whole entry, and binds it to the element underneath', () => {
    const { entries, errors } = parseHandbookBlocks('F.vue', SFC)
    expect(errors).toEqual([])
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.title).toBe('Bring your first teacher in')
    expect(e.section).toBe('getting-people-in')
    expect(e.personas).toEqual(['admin', 'leader', 'school_admin'])
    expect(e.place).toBe('node-home')
    expect(e.anchor).toBe('verb-invite-person')
    expect(e.how).toHaveLength(2)
    expect(e.what).toContain('without them signing up')
    expect(e.note).toContain('their login')
  })
  it('FAILS a block with no element under it — a description must sit above the thing it describes', () => {
    const { errors } = parseHandbookBlocks('F.vue', BLOCK.replace('data-walk="verb-invite-person"', ''))
    expect(errors.some((e: string) => e.includes('must sit directly above'))).toBe(true)
  })
  it('rejects a stray line rather than swallowing it', () => {
    const { errors } = parseHandbookBlocks('F.vue', BLOCK.replace('       keywords: teacher, invite', '       something else entirely'))
    expect(errors.some((e: string) => e.includes('stray line'))).toBe(true)
  })
})

describe('validateHandbookEntry (no silent blanks)', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    ...parseHandbookBlocks('F.vue', SFC).entries[0], ...over,
  })
  it('accepts the real thing', () => {
    expect(validateHandbookEntry(entry())).toEqual([])
  })
  it('FAILS an empty description', () => {
    expect(validateHandbookEntry(entry({ what: '' })).length).toBe(1)
    expect(validateHandbookEntry(entry({ where: '  ' })).length).toBe(1)
    expect(validateHandbookEntry(entry({ how: [] })).length).toBe(1)
  })
  it('FAILS placeholder text — a blank with words in it', () => {
    expect(validateHandbookEntry(entry({ what: 'TODO write this' })).length).toBe(1)
  })
  it('fails an unknown section or role, and parentheses', () => {
    expect(validateHandbookEntry(entry({ section: 'making-tea' })).length).toBe(1)
    expect(validateHandbookEntry(entry({ personas: ['pupil'] })).length).toBeGreaterThan(0)
    expect(validateHandbookEntry(entry({ note: 'A link (their login).' })).length).toBe(1)
  })
})

describe('gateHandbookCoverage (every capability has a description)', () => {
  const entries = parseHandbookBlocks('F.vue', SFC).entries
  it('passes when every anchor is described or walked', () => {
    expect(gateHandbookCoverage(['verb-invite-person'], entries, []).failures).toEqual([])
    expect(gateHandbookCoverage(['step-anchor'], [], [walk({ steps: [{ anchor: 'step-anchor', say: 'x', advance: { on: 'next' } }] })]).failures).toEqual([])
  })
  it('FAILS an anchor that declares a capability and says nothing about itself', () => {
    const { failures } = gateHandbookCoverage(['verb-invite-person', 'verb-mystery'], entries, [])
    expect(failures.some((f: string) => f.includes('verb-mystery'))).toBe(true)
  })
  it('fails a block naming a walk that does not exist, and two entries with one title', () => {
    expect(gateHandbookCoverage([], [{ ...entries[0], walk: 'ghost' }], []).failures.some((f: string) => f.includes('ghost'))).toBe(true)
    expect(gateHandbookCoverage([], [entries[0], entries[0]], []).failures.some((f: string) => f.includes('both titled'))).toBe(true)
  })
})

describe('the freshness backstop (behaviour changed under an unchanged name)', () => {
  const read = (src: string) => {
    const entries = parseHandbookBlocks('F.vue', src).entries
    const fp = (e: any) => fingerprintCapability(src, e.tag, e.tagStart)
    return { entries, fp }
  }
  const pinned = (src: string) => {
    const { entries, fp } = read(src)
    return stampChecked(src, entries[0], fp(entries[0]))
  }

  it('passes once a description is pinned to its capability', () => {
    const src = pinned(SFC)
    const { entries, fp } = read(src)
    expect(gateHandbookFreshness(entries, fp).failures).toEqual([])
  })
  it('FAILS a description that has never been pinned', () => {
    const { entries, fp } = read(SFC)
    const { failures } = gateHandbookFreshness(entries, fp)
    expect(failures.some((f: string) => f.includes('never been pinned'))).toBe(true)
  })
  it('FAILS when the HANDLER changes while the name and the template line do not', () => {
    const changed = pinned(SFC).replace('open.value = role', 'open.value = role; void grantAdmin(role)')
    const { entries, fp } = read(changed)
    const { failures } = gateHandbookFreshness(entries, fp)
    expect(failures.some((f: string) => f.includes('the capability changed'))).toBe(true)
    expect(failures[0]).toContain('--reconfirm')
  })
  it('FAILS when the GATE changes — a capability handed to different people', () => {
    const changed = pinned(SFC).replace('v-if="canInvite"', 'v-if="!member"')
    const { entries, fp } = read(changed)
    expect(gateHandbookFreshness(entries, fp).failures).toHaveLength(1)
  })
  it('FAILS when the LABEL changes — different words, same anchor', () => {
    const changed = pinned(SFC).replace('>Invite a person<', '>Add somebody<')
    const { entries, fp } = read(changed)
    expect(gateHandbookFreshness(entries, fp).failures).toHaveLength(1)
  })
  it('does NOT fire on a restyle — a guard that cries wolf gets routed around', () => {
    const withClass = pinned(SFC.replace('<button v-if', '<button class="verb" v-if'))
    const restyled = withClass.replace('class="verb"', 'class="verb is-primary"')
    const { entries, fp } = read(restyled)
    expect(gateHandbookFreshness(entries, fp).failures).toEqual([])
  })
  it('re-pinning is one step, and is stable', () => {
    const changed = pinned(SFC).replace('open.value = role', 'open.value = String(role)')
    const repaired = pinned(changed)
    const { entries, fp } = read(repaired)
    expect(gateHandbookFreshness(entries, fp).failures).toEqual([])
    // idempotent: a second stamp changes nothing
    expect(pinned(repaired)).toBe(repaired)
  })
})

describe('declarationSource (why the fingerprint is stable)', () => {
  it('reads a one-line arrow without swallowing the rest of the file', () => {
    const src = 'const a = computed(() => x.value)\nconst b = 2\nfunction c() {\n  return 1\n}\n'
    expect(declarationSource(src, 'a')).toBe('const a = computed(() => x.value)')
    expect(declarationSource(src, 'c')).toContain('return 1')
    expect(declarationSource(src, 'nope')).toBeNull()
  })
})

// happy-dom breaks fileURLToPath(import.meta.url) under vitest, so these
// anchor on the runner's cwd (packages/player-vue) like the live-CLI test above.
const HANDBOOK_SRC = readFileSync(join(process.cwd(), 'src/walkthrough/handbook.ts'), 'utf8')
const REAL_RUNTIME_SRC = readFileSync(join(process.cwd(), 'src/walkthrough/useWalkthrough.ts'), 'utf8')

describe('runtime lockstep (sections, role badges, place links)', () => {
  it('passes against the real runtime files', () => {
    expect(gateSections(HANDBOOK_SRC).failures).toEqual([])
    expect(gateRoleBadges(REAL_RUNTIME_SRC, HANDBOOK_SRC).failures).toEqual([])
    expect(gatePlaceLinks(REAL_RUNTIME_SRC, HANDBOOK_SRC).failures).toEqual([])
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
  it('fails when the runtime drops a section the compiler knows', () => {
    const dropped = HANDBOOK_SRC.replace(/\{ id: 'your-school'[^}]*\},\n/, '')
    expect(gateSections(dropped).failures.some((f: string) => f.includes('your-school'))).toBe(true)
  })
  it('fails when the runtime learns a place the page cannot link to', () => {
    const extra = REAL_RUNTIME_SRC.replace("'library',", "'library', 'moon-base',")
    expect(gatePlaceLinks(extra, HANDBOOK_SRC).failures.some((f: string) => f.includes('moon-base'))).toBe(true)
  })
  it('knows every persona and section the compiler declares', () => {
    expect(PERSONAS.length).toBeGreaterThan(0)
    expect(HANDBOOK_SECTIONS.length).toBe(6)
  })
})

// A GATE MUST TEACH ITS OWN REPAIR (Aran's ruling, 2026-09-07, promoting the
// Handbook to main): somebody fixing a live money-path bug at speed hits a
// build failure about prose, and the message alone has to unblock them. So the
// failure names WHERE — file and line — and the repair is one command.
describe('the handbook gates say where the problem is', () => {
  const entries = parseHandbookBlocks('F.vue', SFC).entries

  it('an uncovered anchor is reported at file:line, not as a bare id', () => {
    const { failures } = gateHandbookCoverage(
      [{ id: 'verb-mystery', path: 'packages/player-vue/src/views/schools/StudentsView.vue', line: 200 }],
      entries,
      [],
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('packages/player-vue/src/views/schools/StudentsView.vue:200')
    expect(failures[0]).toContain('data-walk="verb-mystery"')
  })

  it('still accepts a bare id, so nothing that passes ids breaks', () => {
    const { failures } = gateHandbookCoverage(['verb-mystery'], entries, [])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('verb-mystery')
  })

  it('a never-pinned description names its own line and its own anchor', () => {
    const e = { ...entries[0], checked: null, line: 42, anchor: 'verb-invite-person', path: 'F.vue' }
    const { failures } = gateHandbookFreshness([e], () => 'abc123')
    expect(failures[0]).toContain('F.vue:42')
    expect(failures[0]).toContain('--reconfirm "verb-invite-person"')
  })

  it('a stale description names its own line and its own anchor', () => {
    const e = { ...entries[0], checked: 'old', line: 42, anchor: 'verb-invite-person', path: 'F.vue' }
    const { failures } = gateHandbookFreshness([e], () => 'new')
    expect(failures[0]).toContain('F.vue:42')
    expect(failures[0]).toContain('--reconfirm "verb-invite-person"')
  })

  it('parsed blocks carry the line the description starts on', () => {
    const parsed = parseHandbookBlocks('F.vue', SFC).entries
    expect(parsed.every((p: { line: number }) => typeof p.line === 'number' && p.line > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// THE GATE'S OWN DEFECT (job #288 → #289). --check compiled a hypothetical
// pack, announced how many entries it WOULD have, and never once looked at
// pack.json — the file the page imports. Source said 77, the page served 76,
// the gate said OK. These hold the two properties that fixes: the check
// compares SERVED CONTENT, and re-pinning cannot be done in bulk without a
// sentence changing.
// ---------------------------------------------------------------------------

describe('comparePack (the served pack IS the compiled pack)', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'add-students-to-a-class', title: 'Add students to a class', section: 'getting-people-in',
    personas: ['teacher'], keywords: ['add'], place: { route: 'class-detail' },
    anchor: 'class-student-add', source: 'F.vue', walk: null,
    what: 'Putting a pupil into this class.', where: 'The class page.', how: ['Tap it.'], ...over,
  })
  const pack = (handbook: unknown[], walks: unknown[] = []) => ({ handbook, walks })

  it('passes when the served pack is what the source compiles to', () => {
    expect(comparePack(pack([entry()]), pack([entry()]))).toEqual([])
  })

  it('FAILS on the exact defect: a capability in the source and not in the served pack', () => {
    const failures = comparePack(pack([entry(), entry({ id: 'other', title: 'Other' })]), pack([entry()]))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('"other" is in the source but NOT in pack.json')
  })

  it('FAILS on same-count drift — a count matching is not agreement', () => {
    const failures = comparePack(pack([entry()]), pack([entry({ what: 'Something else entirely.' })]))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('differs from pack.json — what')
  })

  it('FAILS on an entry the served pack still shows after the source dropped it', () => {
    const failures = comparePack(pack([]), pack([entry()]))
    expect(failures[0]).toContain('no longer in the source')
  })

  it('FAILS when there is no served pack at all', () => {
    expect(comparePack(pack([entry()]), null)).toHaveLength(1)
  })
})

describe('the two-part stamp (no silent bulk re-pin)', () => {
  const parse = (src: string) => parseHandbookBlocks('F.vue', src).entries[0]

  it('the stamp records the prose it was made against, and the code half still gates', () => {
    const e = parse(SFC)
    const stamp = `${fingerprintCapability(SFC, e.tag, e.tagStart)}.${proseFingerprint(e)}`
    const stampedSrc = stampChecked(SFC, e, stamp)
    const pinned = parse(stampedSrc)
    const fp = (x: any) => fingerprintCapability(stampedSrc, x.tag, x.tagStart)
    expect(checkedCode(pinned.checked)).toBe(fp(pinned))
    expect(checkedProse(pinned.checked)).toBe(proseFingerprint(pinned))
    expect(gateHandbookFreshness([pinned], fp).failures).toEqual([])
  })

  it('says whether the sentence changed since the stamp — the thing --reconfirm now asks', () => {
    const e = parse(SFC)
    const pinned = parse(stampChecked(SFC, e, `${fingerprintCapability(SFC, e.tag, e.tagStart)}.${proseFingerprint(e)}`))
    // The prose half is what --reconfirm compares; the code half is the gate's.
    // Untouched prose: the tool refuses to re-pin without --unchanged.
    expect(checkedProse(pinned.checked)).toBe(proseFingerprint(pinned))
    // Rewritten prose: the tool re-pins, because a sentence actually changed.
    const rewritten = { ...pinned, what: 'Something the button now genuinely does.' }
    expect(checkedProse(pinned.checked)).not.toBe(proseFingerprint(rewritten))
  })

  it('a legacy one-part stamp reads as code-only, so nothing pinned before this breaks', () => {
    expect(checkedCode('e36b80b5')).toBe('e36b80b5')
    expect(checkedProse('e36b80b5')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// THE WALK-STEP STAMP (job #124·G → this one). A walk step is a sentence about
// a button too. The build already fails when a step points at a button that is
// GONE; nothing noticed when a button kept its anchor and its label and changed
// what it DOES. These hold the same three properties the Handbook stamp has —
// every step is pinned, a behaviour change under an unchanged name trips it,
// and a restyle does not — plus the one this job exists for: the attribute name
// is a PARAMETER, so data-intel is covered without a second mechanism.
// ---------------------------------------------------------------------------

const STEP_SFC = `<script setup lang="ts">
function invite(role: string) { open.value = role }
</script>
<template>
  <button data-walk="verb-invite-person" @click="invite('teacher')">Invite a person</button>
</template>`

const INTEL_SFC = `<script setup lang="ts">
function askAgain() { refresh() }
</script>
<template>
  <button data-intel="verb-ask-again" @click="askAgain()">Ask again</button>
</template>`

const stepWalk = (over: Record<string, unknown> = {}) => walk({
  steps: [{ anchor: 'verb-invite-person', say: 'Tap **Invite a person**.', advance: { on: 'next' } }],
  ...over,
})

// The compile CLI's own plumbing, in three lines: index the anchors, fingerprint
// whichever sites carry the id.
const fpOfAnchor = (files: { path: string, src: string }[], attrs?: string[]) => {
  const sites = indexAnchors(files, attrs)
  return (id: string) => anchorFingerprint(sites.get(id))
}
const pinStep = (step: any, fp: (id: string) => string | null) => ({
  ...step, checked: `${fp(step.anchor)}.${stepProseFingerprint(step)}`,
})

describe('the walk-step freshness stamp', () => {
  const files = [{ path: 'F.vue', src: STEP_SFC }]

  it('FAILS a step that has never been pinned to what it points at', () => {
    const { failures } = gateWalkFreshness([stepWalk()], fpOfAnchor(files))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('never been pinned')
    expect(failures[0]).toContain('--reconfirm-walks "test-walk:verb-invite-person"')
  })

  it('passes once the step is pinned', () => {
    const fp = fpOfAnchor(files)
    const w = stepWalk({ steps: [pinStep(stepWalk().steps[0], fp)] })
    expect(gateWalkFreshness([w], fp).failures).toEqual([])
  })

  it('FAILS when the HANDLER changes while the anchor, the label and the step do not', () => {
    const w = stepWalk({ steps: [pinStep(stepWalk().steps[0], fpOfAnchor(files))] })
    const changed = [{ path: 'F.vue', src: STEP_SFC.replace('open.value = role', 'open.value = role; void grantAdmin(role)') }]
    const { failures } = gateWalkFreshness([w], fpOfAnchor(changed))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('changed since the step was last read')
  })

  it('does NOT fire on a restyle — a guard that cries wolf gets routed around', () => {
    const styled = [{ path: 'F.vue', src: STEP_SFC.replace('<button ', '<button class="verb" ') }]
    const w = stepWalk({ steps: [pinStep(stepWalk().steps[0], fpOfAnchor(styled))] })
    const restyled = [{ path: 'F.vue', src: styled[0].src.replace('class="verb"', 'class="verb is-primary"') }]
    expect(gateWalkFreshness([w], fpOfAnchor(restyled)).failures).toEqual([])
  })

  it('says WHERE — the walk file, the walk id, the step number and the anchor', () => {
    const { failures } = gateWalkFreshness([stepWalk()], fpOfAnchor(files), () => 'tools/walkthrough/walks/test-walk.json')
    expect(failures[0]).toContain('tools/walkthrough/walks/test-walk.json')
    expect(failures[0]).toContain('walk "test-walk" step 1, anchor "verb-invite-person"')
  })

  it('stays quiet about a missing anchor — gateAnchors already fails that, hard', () => {
    expect(gateWalkFreshness([stepWalk()], fpOfAnchor([{ path: 'F.vue', src: '<div />' }])).failures).toEqual([])
  })

  it('keeps the stamp out of the shipped pack — the player has no use for a hash', () => {
    const w = stepWalk({ steps: [pinStep(stepWalk().steps[0], fpOfAnchor(files))] })
    const pack = assemblePack([w], [])
    expect(pack.walks[0].steps[0].checked).toBeUndefined()
    expect(pack.walks[0].steps[0].say).toBe('Tap **Invite a person**.')
  })
})

describe('both anchor namespaces (data-walk and data-intel)', () => {
  it('declares the namespaces in one place, data-walk first so nothing changes meaning', () => {
    expect(ANCHOR_ATTRS[0]).toBe('data-walk')
    expect(ANCHOR_ATTRS).toContain('data-intel')
  })

  it('indexes and fingerprints a data-intel anchor exactly like a data-walk one', () => {
    const files = [{ path: 'I.vue', src: INTEL_SFC }]
    expect(indexAnchors(files).get('verb-ask-again')?.[0].attr).toBe('data-intel')
    const w = walk({ steps: [{ anchor: 'verb-ask-again', say: 'Tap it.', advance: { on: 'next' } }] })
    expect(gateWalkFreshness([w], fpOfAnchor(files)).failures[0]).toContain('never been pinned')
    const pinned = walk({ steps: [pinStep(w.steps[0], fpOfAnchor(files))] })
    expect(gateWalkFreshness([pinned], fpOfAnchor(files)).failures).toEqual([])
    const changed = [{ path: 'I.vue', src: INTEL_SFC.replace('refresh()', 'refresh(); wipe()') }]
    expect(gateWalkFreshness([pinned], fpOfAnchor(changed)).failures).toHaveLength(1)
  })

  it('resolves a walk anchor that lives under data-intel, so no walk has to know the namespace', () => {
    const w = walk({ steps: [{ anchor: 'verb-ask-again', say: 'Tap it.', advance: { on: 'next' } }] })
    expect(gateAnchors([w], [{ path: 'I.vue', src: INTEL_SFC }]).failures).toEqual([])
  })

  it('binds a HANDBOOK block to a data-intel element under it', () => {
    const src = INTEL_SFC.replace('  <button data-intel', `  <!-- HANDBOOK Ask the question again
       section: seeing-progress
       roles: leader
       place: node-home
       What it's for. Asking for the number again.
       Where it is. The question page.
       How you do it.
       1. Tap **Ask again**.
  -->
  <button data-intel`)
    const { entries, errors } = parseHandbookBlocks('I.vue', src)
    expect(errors).toEqual([])
    expect(entries[0].anchor).toBe('verb-ask-again')
    expect(entries[0].attr).toBe('data-intel')
  })

  it('WARNS rather than FAILS on an undescribed anchor in a namespace still landing', () => {
    const loose = { id: 'verb-ask-again', attr: 'data-intel', path: 'I.vue', line: 4 }
    const { failures, warnings } = gateHandbookCoverage([loose], [], [])
    expect(failures).toEqual([])
    expect(warnings[0]).toContain('still landing')
    // …and a data-walk anchor is still a hard failure.
    expect(gateHandbookCoverage([{ ...loose, attr: 'data-walk' }], [], []).failures).toHaveLength(1)
  })
})
