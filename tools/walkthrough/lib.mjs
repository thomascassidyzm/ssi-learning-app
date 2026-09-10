/**
 * Walkthrough compiler — the PURE validation half (archive/docs-retired-2026-08-24/walkthrough-engine-scout.md §3).
 *
 * Walks are hand-authored JSON (tools/walkthrough/walks/*.json — the DECISIONS);
 * this module is the DRIFT GATE between them and the live Vue source: a walk
 * step anchored to an element that no longer exists FAILS THE BUILD, exactly
 * like the explainer pack's gate. Kept pure (no fs) so the gates unit-test
 * with fixtures; compile.mjs is the CLI shell that feeds it real files.
 */
import {
  checkedCode, ANCHOR_ATTRS, anchorTagRe, anchorAttrRe, anchorFingerprint,
} from './handbookSource.mjs'

export { ANCHOR_ATTRS, anchorTagRe, anchorAttrRe }

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
  if (!Array.isArray(walk.steps) || !walk.steps.length) at('steps[] must be non-empty')
  // A walk is a CLIP and nothing else since 2026-09-07: the handbook prose
  // lives beside the capability in the .vue source, never here.
  if (walk.handbook || walk.section) {
    at('handbook prose does not live in walk JSON — it lives in an HTML comment above the anchored element')
  }
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
 * Gate 9 — the prose itself, as parsed out of the .vue source.
 *
 * The page's whole claim is that it is the complete map and that it is true.
 * So: a capability with no description does not compile, and a description
 * that says nothing does not compile either.
 */
export function validateHandbookEntry(entry) {
  const errors = []
  const at = (msg) => errors.push(`${entry.path}: HANDBOOK "${entry.title}" — ${msg}`)
  if (!HANDBOOK_SECTIONS.includes(entry.section)) {
    at(`section "${entry.section || ''}" is not one of ${HANDBOOK_SECTIONS.join(', ')}`)
  }
  if (!entry.personas.length) at('roles: is required — say whose capability this is')
  for (const p of entry.personas) if (!PERSONAS.includes(p)) at(`unknown role "${p}"`)
  if (!entry.personas.some((p) => HANDBOOK_PERSONAS.includes(p))) {
    at('a handbook entry needs at least one non-learner role')
  }
  if (!entry.what.trim()) at('"What it\'s for." is required')
  if (!entry.where.trim()) at('"Where it is." is required')
  if (!entry.how.length) at('"How you do it." needs at least one numbered step')
  for (const [i, step] of entry.how.entries()) {
    if (!step.trim()) at(`how step ${i + 1} is empty`)
  }
  const prose = [entry.what, entry.where, entry.note, ...entry.how].join(' ')
  if (/[()]/.test(prose)) at('prose contains parentheses — zero-explanation ruling: say it in the sentence')
  if (/\bTODO\b|\bTBC\b|\bplaceholder\b/i.test(prose)) at('prose is a placeholder — write the sentence or delete the block')
  return errors
}

/**
 * Gate 9b — COVERAGE. Every data-walk anchor in the source is a declared
 * capability, so every one must either carry a description or be a step of a
 * walkthrough clip whose own entry describes it. A button that announces
 * itself as a capability and then has nothing to say about itself is exactly
 * the silent blank this page exists to abolish.
 */
export function gateHandbookCoverage(anchors, entries, walks, { failAttrs = ['data-walk'] } = {}) {
  const failures = []
  const warnings = []
  const described = new Set(entries.flatMap((e) => [e.anchor, ...(e.parts ?? [])]))
  const stepped = new Set(walks.flatMap((w) => (w.steps ?? []).map((s) => s.anchor)))
  for (const a of anchors) {
    // Accepts a bare id or a { id, attr, path, line } location; the location
    // form is what the CLI passes, so the message can send someone straight to
    // the spot. A bare id is read as data-walk, so nothing that passes ids
    // changes meaning.
    const id = typeof a === 'string' ? a : a.id
    const attr = (typeof a === 'string' ? null : a.attr) ?? 'data-walk'
    if (described.has(id) || stepped.has(id)) continue
    const at = typeof a === 'string' ? '' : `${a.path}:${a.line} — `
    // A namespace whose surface has not landed yet WARNS. Turning an unmerged
    // branch's anchors into a build failure on dev would break the tree for
    // work nobody has merged; the freshness stamp still covers them the moment
    // a walk or a description names one.
    if (!failAttrs.includes(attr)) {
      warnings.push(`COVERAGE: ${at}${attr}="${id}" declares a capability with nothing said about it yet — a warning while the ${attr} surface is still landing`)
      continue
    }
    failures.push(`COVERAGE: ${at}${attr}="${id}" declares a capability with nothing said about it. Write a HANDBOOK comment directly above that element (see the worked example below), or add "${id}" to the parts: line of the capability it belongs to, or delete the anchor`)
  }
  const ids = new Set(walks.map((w) => w.id))
  for (const e of entries) {
    if (e.walk && !ids.has(e.walk)) failures.push(`${e.path}: HANDBOOK "${e.title}" names walk "${e.walk}", which does not exist`)
  }
  const seen = new Set()
  for (const e of entries) {
    const key = e.title.toLowerCase()
    if (seen.has(key)) failures.push(`${e.path}: two handbook entries are both titled "${e.title}" — one capability, one description`)
    seen.add(key)
  }
  return { failures, warnings }
}

/**
 * Gate 9c — FRESHNESS, the backstop.
 *
 * The primary mechanism is not this gate: it is that the description sits
 * next to the code, so the agent changing a capability rewrites its sentence
 * in the same edit. This exists only for the case where somebody did not.
 * The fingerprint covers the gate, the handler, the label and the handler's
 * own source — see fingerprintCapability — so a behaviour change under an
 * unchanged name fails the build naming the capability, and the repair is
 * one command.
 */
export function gateHandbookFreshness(entries, fingerprintOf) {
  const failures = []
  for (const e of entries) {
    const now = fingerprintOf(e)
    // file:line of the description itself, so the message opens the right spot.
    const at = e.line ? `${e.path}:${e.line}` : e.path
    if (!e.checked) {
      failures.push(`STALE: ${at} — HANDBOOK "${e.title}" has never been pinned to what it describes. Read the sentence there against the code, then run: node tools/walkthrough/compile.mjs --reconfirm "${e.anchor}"`)
      continue
    }
    if (checkedCode(e.checked) !== now) {
      failures.push(`STALE: ${at} — "${e.title}": the capability changed since this description was last read. Re-read the sentence there against the code, fix it if it now lies, then run: node tools/walkthrough/compile.mjs --reconfirm "${e.anchor}"`)
    }
  }
  return { failures }
}

/**
 * Gate 9d — FRESHNESS FOR WALK STEPS, the same backstop over the clips.
 *
 * A walk step is a sentence about a button, exactly like a Handbook
 * description — it just lives in tools/walkthrough/walks/*.json rather than
 * beside the code. Today the build fails if a step points at a button that is
 * gone; nothing whatever notices when a button keeps its anchor and its label
 * and changes what it DOES, so every walk stepping it goes on saying the old
 * thing, silently, forever. This is the thing that notices.
 *
 * Same fingerprint, same two-part `<code>.<prose>` stamp, same one-command
 * repair — and the same stated limit: it reads the anchored element's own
 * .vue file and cannot see into a composable, a store action or an API route.
 *
 * @param fingerprintOfAnchor (anchorId) => string|null — null when the anchor
 *   is missing entirely, which gateAnchors already fails on; reporting it
 *   twice would only be noise.
 * @param pathOf (walk) => string — the walk's own JSON file, so the message
 *   opens the file the reader has to edit.
 */
export function gateWalkFreshness(walks, fingerprintOfAnchor, pathOf = (w) => `walk "${w.id}"`) {
  const failures = []
  for (const walk of walks) {
    for (const [i, step] of (walk.steps ?? []).entries()) {
      const now = fingerprintOfAnchor(step.anchor)
      if (!now) continue
      const at = `${pathOf(walk)} — walk "${walk.id}" step ${i + 1}, anchor "${step.anchor}"`
      const repair = `node tools/walkthrough/compile.mjs --reconfirm-walks "${walk.id}:${step.anchor}"`
      if (!step.checked) {
        failures.push(`STALE: ${at} has never been pinned to what it points at. Read what the step says against the code, then run: ${repair}`)
        continue
      }
      if (checkedCode(step.checked) !== now) {
        failures.push(`STALE: ${at}: what this step points at changed since the step was last read. Re-read what it says against the code, fix it if it now lies, then run: ${repair}`)
      }
    }
  }
  return { failures }
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
export function indexAnchors(vueFiles, attrs = ANCHOR_ATTRS) {
  const anchorTags = new Map() // id -> [{ path, attr, tag, tagStart, src }]
  for (const { path, src } of vueFiles) {
    for (const m of src.matchAll(anchorTagRe(attrs))) {
      const id = m[2]
      if (!anchorTags.has(id)) anchorTags.set(id, [])
      anchorTags.get(id).push({ path, attr: m[1], tag: m[0], tagStart: m.index, src })
    }
  }
  return anchorTags
}

export function gateAnchors(walks, vueFiles, attrs = ANCHOR_ATTRS) {
  const failures = []
  const warnings = []
  // Every anchored element, in every namespace, with the enclosing opening tag
  // for the guard check and its offset for the freshness fingerprint.
  const anchorTags = indexAnchors(vueFiles, attrs)
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
        failures.push(`ANCHOR: walk "${walk.id}" anchor "${anchor}" has no ${attrs.map((a) => `${a}="${anchor}"`).join(" or ")} in any .vue source`)
        continue
      }
      if (memberOffered && sites.every(({ tag }) => /v-if="[^"]*!member/.test(tag))) {
        failures.push(`PERSONA: walk "${walk.id}" is offered to member personas but anchor "${anchor}" only exists behind an admin-only v-if="!member" guard`)
      }
    }
  }
  // Orphan anchors are no longer a warning: gateHandbookCoverage makes an
  // undescribed, unwalked anchor a BUILD FAILURE, which is the stronger
  // statement and would only be repeated here as noise.
  return { failures, warnings }
}

/** The runtime's place vocabulary, captured by gatePlaces for the entry checks. */
export const KNOWN_PLACES_CACHE = new Set()

/** Gate 3 — place validity, lockstep with the runtime's KNOWN_PLACES list. */
export function gatePlaces(walks, runtimeSrc) {
  const failures = []
  const m = runtimeSrc.match(/KNOWN_PLACES\s*=\s*\[([^\]]*)\]/)
  if (!m) return { failures: ['LOCKSTEP: useWalkthrough.ts no longer declares KNOWN_PLACES'], places: [] }
  const places = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  KNOWN_PLACES_CACHE.clear()
  for (const p of places) KNOWN_PLACES_CACHE.add(p)
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
 * TWO READINGS, TWO SOURCES, ONE TRUTH. `walks` are the just-in-time clips,
 * authored in tools/walkthrough/walks/*.json. `handbook` is the map, read
 * out of the .vue files themselves — so the prose ships from where the code
 * is, and cannot be edited into a lie without the compiler noticing.
 */
export function assemblePack(walks, entries = []) {
  // The `checked:` stamp is build-time bookkeeping — the player has no use for
  // it, and shipping it would put a hash in front of every learner-facing clip
  // and into the pack's version hash on every re-pin. Strip it here, once, so
  // comparePack keeps comparing what the page actually serves.
  const sortedWalks = [...walks]
    .map((w) => ({ ...w, steps: (w.steps ?? []).map(({ checked: _checked, ...step }) => step) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const handbook = [...entries]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((e) => ({
      id: e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: e.title,
      section: e.section,
      personas: e.personas,
      keywords: e.keywords,
      place: { route: e.place },
      anchor: e.anchor,
      source: e.path,
      walk: e.walk ?? null,
      what: e.what,
      where: e.where,
      how: e.how,
      ...(e.note ? { note: e.note } : {}),
    }))
  return { walks: sortedWalks, handbook }
}

/**
 * Gate 12 — THE SERVED PACK IS THE COMPILED PACK.
 *
 * The defect this exists for, found by cross-model review within thirty
 * minutes of the gate shipping (job #288): --check compiled a hypothetical
 * pack, announced how many entries it WOULD have, and exited without ever
 * looking at packages/player-vue/src/walkthrough/pack.json — the file the
 * Handbook page actually imports. Source had 77 capabilities, the page served
 * 76, and the gate said OK. Two things that must agree, with nothing
 * comparing them, inside the tool built to stop exactly that.
 *
 * So: content, not counts. A count matching is not agreement. Compare every
 * field of every walk and every handbook entry, and name what differs.
 */
export function comparePack(compiled, served) {
  const failures = []
  if (!served) return ['SERVED: packages/player-vue/src/walkthrough/pack.json is missing or unreadable — the page imports it, so it must exist']

  const compare = (kind, keyOf, a, b) => {
    const left = new Map(a.map((x) => [keyOf(x), x]))
    const right = new Map(b.map((x) => [keyOf(x), x]))
    for (const key of left.keys()) {
      if (!right.has(key)) failures.push(`SERVED: ${kind} "${key}" is in the source but NOT in pack.json — the page does not show it`)
    }
    for (const key of right.keys()) {
      if (!left.has(key)) failures.push(`SERVED: ${kind} "${key}" is in pack.json but no longer in the source — the page shows something that is gone`)
    }
    for (const [key, l] of left) {
      const r = right.get(key)
      if (!r) continue
      const fields = [...new Set([...Object.keys(l), ...Object.keys(r)])]
        .filter((f) => JSON.stringify(l[f]) !== JSON.stringify(r[f]))
      if (fields.length) failures.push(`SERVED: ${kind} "${key}" differs from pack.json — ${fields.join(', ')}`)
    }
  }
  compare('handbook entry', (e) => e.id ?? e.title, compiled.handbook ?? [], served.handbook ?? [])
  compare('walk', (w) => w.id, compiled.walks ?? [], served.walks ?? [])
  return failures
}

/** Run every gate; returns { failures, warnings }. */
export function runGates({
  walks, vueFiles, runtimeSrc, rulesJson, evaluateRulesSrc, handbookSrc,
  entries = [], fingerprintOf, attrs = ANCHOR_ATTRS, walkPathOf,
}) {
  const failures = []
  const warnings = []
  for (const w of walks) failures.push(...validateWalkSchema(w))
  failures.push(...gateUniqueIds(walks).failures)
  const anchors = gateAnchors(walks, vueFiles, attrs)
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
  for (const e of entries) {
    failures.push(...validateHandbookEntry(e))
    if (!KNOWN_PLACES_CACHE.has(e.place)) failures.push(`${e.path}: HANDBOOK "${e.title}" — place "${e.place}" is not one the runtime knows`)
  }
  // Locations, not bare ids: an uncovered anchor is reported as file:line so
  // the person who added the button is taken to it, not sent hunting.
  const seenAnchor = new Set()
  const anchorLocations = []
  for (const { path, src } of vueFiles) {
    for (const m of src.matchAll(anchorAttrRe(attrs))) {
      if (seenAnchor.has(m[2])) continue
      seenAnchor.add(m[2])
      anchorLocations.push({ id: m[2], attr: m[1], path, line: src.slice(0, m.index).split('\n').length })
    }
  }
  const coverage = gateHandbookCoverage(anchorLocations, entries, walks)
  failures.push(...coverage.failures)
  warnings.push(...(coverage.warnings ?? []))
  if (fingerprintOf) failures.push(...gateHandbookFreshness(entries, fingerprintOf).failures)
  // The walk steps' own freshness, over whichever namespace each anchor lives
  // in — the index is built once, here, from the same scan the anchor gate uses.
  const sites = indexAnchors(vueFiles, attrs)
  failures.push(...gateWalkFreshness(walks, (id) => anchorFingerprint(sites.get(id)), walkPathOf).failures)
  return { failures, warnings }
}
