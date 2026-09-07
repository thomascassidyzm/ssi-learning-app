/**
 * Walkthrough compiler — the PURE validation half (archive/docs-retired-2026-08-24/walkthrough-engine-scout.md §3).
 *
 * Walks are hand-authored JSON (tools/walkthrough/walks/*.json — the DECISIONS);
 * this module is the DRIFT GATE between them and the live Vue source: a walk
 * step anchored to an element that no longer exists FAILS THE BUILD, exactly
 * like the explainer pack's gate. Kept pure (no fs) so the gates unit-test
 * with fixtures; compile.mjs is the CLI shell that feeds it real files.
 */

export const PERSONAS = ['admin', 'leader', 'school_admin', 'teacher', 'learner']
export const ADVANCE_KINDS = ['next', 'click', 'visible']

// HANDBOOK (2026-09-07) — the six sections the Handbook page groups entries
// under. Lockstep-checked against the runtime's own list, exactly like
// KNOWN_PLACES: a section renamed in one place and not the other FAILS the
// build rather than dropping entries off the page silently.
export const HANDBOOK_SECTIONS = [
  'getting-people-in',
  'running-classes',
  'seeing-progress',
  'courses-and-content',
  'your-school',
  'your-own-account',
]

// The handbook is the NON-LEARNER map: a leader, school admin, teacher or
// tutor looking at what the dashboard can do. Learner-only walks belong to
// the learner hub and are exempt from the handbook requirement.
export const HANDBOOK_PERSONAS = ['admin', 'leader', 'school_admin', 'teacher']

/** True for an entry the Handbook page must carry prose for. */
export function isHandbookEntry(walk) {
  return (walk?.personas ?? []).some((p) => HANDBOOK_PERSONAS.includes(p))
}

// Member personas — anyone who is NOT ssi_admin. A walk offered to any of
// these must never anchor to an element behind the admin-only marker.
// 'learner' (A-159) is the furthest of all from admin, so it belongs here.
export const MEMBER_PERSONAS = ['leader', 'school_admin', 'teacher', 'learner']

// Gate 6 — the destructive-verb denylist (founder ruling: click-through only
// on reversible verbs; a click-advance step touching a destructive or
// minting verb is a BUILD FAILURE, not a style nit). Matched against the
// step's anchor id. Point-at (advance: next) steps may still reference them.
export const DESTRUCTIVE_ANCHOR_PATTERNS = [
  /delete/i, /purge/i, /entitlement/i, /remint/i, /re-mint/i, /rotate/i,
  /revoke/i, /submit/i, /grant/i, /expire/i, /play/i, /toggle/i,
]

/** Structural schema check — one error string per violation. */
export function validateWalkSchema(walk) {
  const errors = []
  const at = (msg) => errors.push(`walk "${walk?.id ?? '?'}": ${msg}`)
  if (!walk || typeof walk !== 'object') return ['walk is not an object']
  if (!walk.id || !/^[a-z0-9-]+$/.test(walk.id)) at('id must be kebab-case')
  if (!walk.title || typeof walk.title !== 'string') at('title is required')
  if (!Array.isArray(walk.personas) || !walk.personas.length) at('personas[] is required')
  for (const p of walk.personas ?? []) {
    if (!PERSONAS.includes(p)) at(`unknown persona "${p}"`)
  }
  // topic + keywords (A-159 hub) — the chip label and the search vocabulary.
  // Optional so every pre-hub walk stays valid; when present they must be
  // usable, because a blank chip or a stray keyword is a lying door.
  if (walk.topic !== undefined && (typeof walk.topic !== 'string' || !walk.topic.trim())) {
    at('topic must be a non-empty string when present')
  }
  if (walk.keywords !== undefined) {
    if (!Array.isArray(walk.keywords)) at('keywords must be an array of strings')
    else for (const k of walk.keywords) {
      if (typeof k !== 'string' || !k.trim()) at('keywords entries must be non-empty strings')
      else if (k !== k.toLowerCase()) at(`keyword "${k}" must be lower-case (search normalises to lower-case)`)
    }
  }
  if (!walk.place || typeof walk.place.route !== 'string') at('place.route is required')
  if (walk.place?.kinds && !Array.isArray(walk.place.kinds)) at('place.kinds must be an array')
  // steps[] is OPTIONAL since the handbook (2026-09-07): an entry with prose
  // and no clip is a first-class capability, it just has no "Show me". When
  // present it must still be a real walk.
  if (walk.steps !== undefined && (!Array.isArray(walk.steps) || !walk.steps.length)) {
    at('steps[] must be non-empty when present')
  }
  if (!Array.isArray(walk.steps) && walk.anchor === undefined) {
    at('an entry with no steps[] must name an anchor')
  }
  if (walk.anchor !== undefined && !/^[a-z0-9-]+$/.test(String(walk.anchor))) {
    at('anchor must be kebab-case')
  }
  errors.push(...validateHandbookBlock(walk))
  walk.steps?.forEach((s, i) => {
    if (!s.anchor || !/^[a-z0-9-]+$/.test(s.anchor)) at(`step ${i + 1}: anchor must be kebab-case`)
    if (!s.say || typeof s.say !== 'string') at(`step ${i + 1}: say is required`)
    const on = s.advance?.on
    if (!ADVANCE_KINDS.includes(on)) at(`step ${i + 1}: advance.on must be one of ${ADVANCE_KINDS.join('/')}`)
    if (s.terminal && i !== walk.steps.length - 1) at(`step ${i + 1}: terminal only allowed on the last step`)
  })
  const dupes = new Set()
  const seen = new Set()
  for (const w of [walk.id]) { if (seen.has(w)) dupes.add(w); seen.add(w) }
  return errors
}

/**
 * Gate 9 — the handbook block. Every non-learner entry carries prose that
 * reads standalone: what it is for, where it is, and the numbered steps. An
 * entry without prose does not compile, because the page's whole claim is
 * that it is the complete map.
 *
 * Prose laws are the explainer's own (tools/explainer/rulings/*.md and the
 * header of explainer/learnerExplainers.ts): no parentheses anywhere, since
 * an aside is an explanation and this product explains by example.
 */
export function validateHandbookBlock(walk) {
  const errors = []
  const at = (msg) => errors.push(`walk "${walk?.id ?? '?'}": ${msg}`)
  if (!isHandbookEntry(walk)) {
    // A learner-only entry with prose would be written and never rendered —
    // the page is the non-learner map. Only said where the personas are
    // themselves valid, so an unknown persona reports once, not twice.
    const learnerOnly = (walk?.personas ?? []).every((p) => p === 'learner')
    if (learnerOnly && walk?.handbook) at('learner-only entries carry no handbook block')
    return errors
  }
  if (!HANDBOOK_SECTIONS.includes(walk.section)) {
    at(`section "${walk.section ?? ''}" is not one of ${HANDBOOK_SECTIONS.join(', ')}`)
  }
  const hb = walk.handbook
  if (!hb || typeof hb !== 'object') {
    at('handbook block is required — a capability with no prose is a hole in the page')
    return errors
  }
  for (const field of ['what', 'where']) {
    if (typeof hb[field] !== 'string' || !hb[field].trim()) at(`handbook.${field} must be non-empty prose`)
  }
  if (!Array.isArray(hb.how) || !hb.how.length) at('handbook.how must be a non-empty array of steps')
  else hb.how.forEach((step, i) => {
    if (typeof step !== 'string' || !step.trim()) at(`handbook.how step ${i + 1} must be non-empty prose`)
  })
  if (hb.note !== undefined && (typeof hb.note !== 'string' || !hb.note.trim())) {
    at('handbook.note must be non-empty prose when present')
  }
  const prose = [hb.what, hb.where, hb.note, ...(Array.isArray(hb.how) ? hb.how : [])]
    .filter((x) => typeof x === 'string').join(' ')
  if (/[()]/.test(prose)) at('handbook prose contains parentheses — zero-explanation ruling: say it in the sentence')
  return errors
}

/**
 * Gate 10 — section lockstep with the runtime, the same shape gatePlaces
 * uses for KNOWN_PLACES. The page reads its sections from the runtime list;
 * if the two drift, entries silently vanish from the page, so they can't.
 */
export function gateSections(handbookSrc) {
  const failures = []
  const m = handbookSrc.match(/HANDBOOK_SECTIONS\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return { failures: ['LOCKSTEP: handbook.ts no longer declares HANDBOOK_SECTIONS'] }
  const runtime = [...m[1].matchAll(/id:\s*'([^']+)'/g)].map((x) => x[1])
  for (const id of HANDBOOK_SECTIONS) {
    if (!runtime.includes(id)) failures.push(`LOCKSTEP: handbook.ts is missing section "${id}"`)
  }
  for (const id of runtime) {
    if (!HANDBOOK_SECTIONS.includes(id)) failures.push(`LOCKSTEP: handbook.ts declares unknown section "${id}"`)
  }
  return { failures }
}

/**
 * Gate 11 — role lockstep. The page badges every entry with whose capability
 * it is, so the badge vocabulary has to be the SAME set of roles the engine
 * and the runtime already police: the compiler's PERSONAS, the runtime's
 * WalkPersona union, and a label for each. A role added, renamed or dropped
 * in any one of the three fails the build rather than rendering a blank pill.
 */
export function gateRoleBadges(runtimeSrc, handbookSrc) {
  const failures = []
  const m = runtimeSrc.match(/export type WalkPersona\s*=([^\n]*(?:\n\s*\|[^\n]*)*)/)
  if (!m) return { failures: ['LOCKSTEP: useWalkthrough.ts no longer declares the WalkPersona union'] }
  const union = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  for (const p of PERSONAS) {
    if (!union.includes(p)) failures.push(`LOCKSTEP: WalkPersona union is missing persona "${p}"`)
  }
  for (const p of union) {
    if (!PERSONAS.includes(p)) failures.push(`LOCKSTEP: WalkPersona union declares unknown persona "${p}"`)
  }
  const b = handbookSrc.match(/ROLE_BADGES[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!b) return { failures: [...failures, 'LOCKSTEP: handbook.ts no longer declares ROLE_BADGES'] }
  const labelled = [...b[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]])
  const byRole = new Map(labelled)
  for (const p of PERSONAS) {
    if (!byRole.has(p)) failures.push(`LOCKSTEP: ROLE_BADGES has no label for persona "${p}" — an unbadged capability`)
    else if (!byRole.get(p).trim()) failures.push(`LOCKSTEP: ROLE_BADGES label for "${p}" is blank`)
  }
  for (const [role] of labelled) {
    if (!PERSONAS.includes(role)) failures.push(`LOCKSTEP: ROLE_BADGES labels unknown persona "${role}"`)
  }
  return { failures }
}

/**
 * Gate 12 — place-link lockstep. The Handbook's "Take me there" resolves a
 * place to a router target; every place the runtime knows must have one, or
 * a capability lands the reader nowhere.
 */
export function gatePlaceLinks(runtimeSrc, handbookSrc) {
  const failures = []
  const m = runtimeSrc.match(/KNOWN_PLACES\s*=\s*\[([^\]]*)\]/)
  if (!m) return { failures: ['LOCKSTEP: useWalkthrough.ts no longer declares KNOWN_PLACES'] }
  const places = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  const b = handbookSrc.match(/PLACE_LINKS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!b) return { failures: ['LOCKSTEP: handbook.ts no longer declares PLACE_LINKS'] }
  const mapped = [...b[1].matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((x) => x[1])
  for (const place of places) {
    if (!mapped.includes(place)) failures.push(`LOCKSTEP: handbook.ts PLACE_LINKS has no target for place "${place}"`)
  }
  for (const place of mapped) {
    if (!places.includes(place)) failures.push(`LOCKSTEP: handbook.ts PLACE_LINKS targets unknown place "${place}"`)
  }
  return { failures }
}

/**
 * Gate 1+2 — anchor existence and persona visibility, against the real Vue
 * source. `vueFiles` = [{ path, src }].
 *
 * Persona-visibility heuristic (same one the explainer compiler uses on
 * NodeActionBar): an element whose OWN opening tag carries a v-if containing
 * `!member` is admin-only; a walk offered to any member persona must not
 * reference it.
 */
export function gateAnchors(walks, vueFiles) {
  const failures = []
  const warnings = []
  // data-walk="id" occurrences, with the enclosing opening tag for the guard check.
  const anchorTags = new Map() // id -> [{ path, tag }]
  for (const { path, src } of vueFiles) {
    for (const m of src.matchAll(/<[a-zA-Z][^>]*\bdata-walk="([a-z0-9-]+)"[^>]*>/gs)) {
      const id = m[1]
      if (!anchorTags.has(id)) anchorTags.set(id, [])
      anchorTags.get(id).push({ path, tag: m[0] })
    }
  }
  const referenced = new Set()
  for (const walk of walks) {
    const memberOffered = walk.personas.some((p) => MEMBER_PERSONAS.includes(p))
    // The entry's own anchor counts exactly like a step's: this is what
    // extends the no-drift property to the prose-only handbook entries —
    // delete the button in the .vue source and the page stops building.
    const anchors = [
      ...(walk.anchor ? [walk.anchor] : []),
      ...(walk.steps ?? []).map((s) => s.anchor),
    ]
    for (const anchor of anchors) {
      referenced.add(anchor)
      const sites = anchorTags.get(anchor)
      if (!sites) {
        failures.push(`ANCHOR: walk "${walk.id}" anchor "${anchor}" has no data-walk="${anchor}" in any .vue source`)
        continue
      }
      if (memberOffered && sites.every(({ tag }) => /v-if="[^"]*!member/.test(tag))) {
        failures.push(`PERSONA: walk "${walk.id}" is offered to member personas but anchor "${anchor}" only exists behind an admin-only v-if="!member" guard`)
      }
    }
  }
  for (const id of anchorTags.keys()) {
    if (!referenced.has(id)) warnings.push(`orphan anchor data-walk="${id}" — no walk references it`)
  }
  return { failures, warnings }
}

/** Gate 3 — place validity, lockstep with the runtime's KNOWN_PLACES list. */
export function gatePlaces(walks, runtimeSrc) {
  const failures = []
  const m = runtimeSrc.match(/KNOWN_PLACES\s*=\s*\[([^\]]*)\]/)
  if (!m) return { failures: ['LOCKSTEP: useWalkthrough.ts no longer declares KNOWN_PLACES'], places: [] }
  const places = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  for (const walk of walks) {
    if (!places.includes(walk.place.route)) {
      failures.push(`PLACE: walk "${walk.id}" place.route "${walk.place.route}" is not in the runtime's KNOWN_PLACES (${places.join(', ')})`)
    }
  }
  return { failures, places }
}

/**
 * Gate 4 — offer lockstep: every walk:<id> CTA in the explainer's rules.json
 * must name a walk in this pack, and the runtime evaluator must handle the
 * walk: prefix at all.
 */
export function gateOffers(walks, rulesJson, evaluateRulesSrc) {
  const failures = []
  const ids = new Set(walks.map((w) => w.id))
  for (const rule of rulesJson.rules ?? []) {
    const target = rule.cta?.target ?? ''
    if (target.startsWith('walk:')) {
      const id = target.slice(5)
      if (!ids.has(id)) failures.push(`OFFER: rules.json rule "${rule.id}" targets walk:${id} but no such walk exists in the pack`)
    }
  }
  if (!evaluateRulesSrc.includes("'walk:'")) {
    failures.push("LOCKSTEP: evaluateRules.ts no longer handles the 'walk:' CTA prefix")
  }
  return { failures }
}

/** Gate 6 — a click-advance step must never touch a destructive/minting verb. */
export function gateSafety(walks) {
  const failures = []
  for (const walk of walks) {
    for (const step of walk.steps ?? []) {
      if (step.advance?.on !== 'click') continue
      if (DESTRUCTIVE_ANCHOR_PATTERNS.some((re) => re.test(step.anchor))) {
        failures.push(`SAFETY: walk "${walk.id}" click-advance step anchors "${step.anchor}" — destructive/minting verbs are show-and-point ONLY (advance.on: next)`)
      }
    }
  }
  return { failures }
}

/**
 * Gate 7 — never-auto-play, structurally. startWalk() in any .vue source may
 * only appear inside an @click handler attribute: a walk starts from a user
 * tap or not at all. A mounted-hook / watcher / query-param autostart shows
 * up as a script-block or non-click call and FAILS the build.
 */
export function gateNoAutoPlay(vueFiles) {
  const failures = []
  for (const { path, src } of vueFiles) {
    const calls = (src.match(/startWalk\s*\(/g) ?? []).length
    if (!calls) continue
    const inClick = (src.match(/@click(?:\.[a-z.]+)?="[^"]*startWalk\s*\([^"]*"/g) ?? []).length
    if (calls !== inClick) {
      failures.push(`AUTOPLAY: ${path} calls startWalk() outside an @click handler — walks must only ever start from a user tap`)
    }
  }
  return { failures }
}

/**
 * Gate 8 — runtime-denylist lockstep: useWalkthrough.ts carries a runtime
 * mirror of DESTRUCTIVE_ANCHOR_PATTERNS (so a stale pack can't click-advance
 * a destructive verb at runtime). Every build-time pattern must appear in the
 * runtime list verbatim, or the mirror has drifted.
 */
export function gateRuntimeDenylist(runtimeSrc) {
  const failures = []
  const m = runtimeSrc.match(/DESTRUCTIVE_ANCHOR_PATTERNS\s*=\s*\[([^\]]*)\]/)
  if (!m) {
    return { failures: ['LOCKSTEP: useWalkthrough.ts no longer declares DESTRUCTIVE_ANCHOR_PATTERNS — the runtime safety mirror is gone'] }
  }
  const runtime = new Set([...m[1].matchAll(/\/(?:[^/\\\n]|\\.)+\/[a-z]*/g)].map((x) => x[0]))
  for (const re of DESTRUCTIVE_ANCHOR_PATTERNS) {
    if (!runtime.has(re.toString())) {
      failures.push(`LOCKSTEP: runtime denylist in useWalkthrough.ts is missing ${re} — mirror it verbatim`)
    }
  }
  return { failures }
}

/** Duplicate walk ids across files. */
export function gateUniqueIds(walks) {
  const failures = []
  const seen = new Set()
  for (const w of walks) {
    if (seen.has(w.id)) failures.push(`SCHEMA: duplicate walk id "${w.id}"`)
    seen.add(w.id)
  }
  return { failures }
}

/**
 * Deterministic pack assembly (version = content hash, stamped by the CLI).
 *
 * TWO readings of ONE source. `walks` is the just-in-time engine's list and
 * only ever holds entries that actually have steps, so the overlay's
 * contract is unchanged. `handbook` is the map: every non-learner entry,
 * clip or no clip, in section order, carrying its prose and the personas
 * the page badges it with.
 */
export function assemblePack(entries) {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id))
  const walks = sorted.filter((e) => Array.isArray(e.steps) && e.steps.length)
    .map(({ handbook: _handbook, section: _section, anchor: _anchor, ...walk }) => walk)
  const handbook = sorted.filter(isHandbookEntry).map((e) => ({
    id: e.id,
    title: e.title,
    section: e.section,
    personas: e.personas,
    keywords: e.keywords ?? [],
    place: e.place,
    anchor: e.anchor ?? e.steps?.[0]?.anchor,
    walk: Array.isArray(e.steps) && e.steps.length ? e.id : null,
    ...e.handbook,
  }))
  return { walks, handbook }
}

/** Run every gate; returns { failures, warnings }. */
export function runGates({ walks, vueFiles, runtimeSrc, rulesJson, evaluateRulesSrc, handbookSrc }) {
  const failures = []
  const warnings = []
  for (const w of walks) failures.push(...validateWalkSchema(w))
  failures.push(...gateUniqueIds(walks).failures)
  const anchors = gateAnchors(walks, vueFiles)
  failures.push(...anchors.failures)
  warnings.push(...anchors.warnings)
  failures.push(...gatePlaces(walks, runtimeSrc).failures)
  failures.push(...gateOffers(walks, rulesJson, evaluateRulesSrc).failures)
  failures.push(...gateSafety(walks).failures)
  failures.push(...gateNoAutoPlay(vueFiles).failures)
  failures.push(...gateRuntimeDenylist(runtimeSrc).failures)
  if (handbookSrc !== undefined) {
    failures.push(...gateSections(handbookSrc).failures)
    failures.push(...gateRoleBadges(runtimeSrc, handbookSrc).failures)
    failures.push(...gatePlaceLinks(runtimeSrc, handbookSrc).failures)
  }
  return { failures, warnings }
}
