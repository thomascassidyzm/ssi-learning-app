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
  checkedCode, ANCHOR_ATTRS, ANCHOR_SURFACES, anchorTagRe, anchorAttrRe, anchorFingerprint,
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
      // Which surface this capability belongs to — the schools dashboard or
      // the intelligence surface — read from the anchor's own namespace.
      surface: ANCHOR_SURFACES[e.attr] ?? 'schools',
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

// ---------------------------------------------------------------------------
// Gate 13 — CLIP COVERAGE, "as we go" (Tom, 2026-09-15: "the handbook is
// STILL just a bunch of prose in most cases … we should be building the clips
// for everything else as we go along"). Doctrine 2026-08-18: every feature is
// either visually obvious or covered by a drift-gated walkthrough.
//
// Two units, one registry (tools/walkthrough/coverage.json):
//
//   capabilities — every HANDBOOK entry is either STEPPED by a walk, declared
//     "obvious" with a sentence saying why nobody needs showing, or on the
//     "missing" backlog with a note. None of the three = build failure. The
//     backlog is honest debt, enrolled in one pass on 2026-09-15; every NEW
//     capability after that has to be clipped or declared by the agent adding
//     it, in the same change. A capability listed as obvious or missing that
//     has since gained a walk fails too, so the registry never carries stale
//     debt; one whose anchor is gone fails for the same reason.
//
//   pages — every route view the router imports under views/ must carry an
//     anchor itself or through a .vue it imports one level down, or be
//     declared under pages.obvious / pages.missing. This is the check the
//     anchor gate cannot do: a page with NO anchors at all was invisible to
//     every gate before this one — the admin Messages composer (#821) and the
//     phone Users search (#789) shipped that way.
// ---------------------------------------------------------------------------

/** The view files the router lazy-imports, plus one level of the .vue files each imports. */
export function routeViewsFrom(routerSrc, vueFiles) {
  const byPath = new Map(vueFiles.map((f) => [f.path, f.src]))
  // Both quote styles: a double-quoted import is the same route (job #860).
  const views = [...new Set([...routerSrc.matchAll(/import\(\s*(['"])@\/(views\/[^'"]+\.vue)\1\s*\)/g)].map((m) => `packages/player-vue/src/${m[2]}`))]
  return views.map((path) => {
    const src = byPath.get(path) ?? ''
    const children = []
    for (const m of src.matchAll(/from\s+(['"])(@\/[^'"]+\.vue|\.{1,2}\/[^'"]+\.vue)\1/g)) {
      const spec = m[2]
      if (spec.startsWith('@/')) children.push(`packages/player-vue/src/${spec.slice(2)}`)
      else {
        const parts = path.split('/').slice(0, -1)
        for (const seg of spec.split('/')) {
          if (seg === '..') parts.pop()
          else if (seg !== '.') parts.push(seg)
        }
        children.push(parts.join('/'))
      }
    }
    return { path, src, children: children.map((c) => ({ path: c, src: byPath.get(c) ?? '' })) }
  })
}

function hasAnchor(src, attrs) {
  return Boolean(src) && anchorAttrRe(attrs).test(src)
}

export function gateClipCoverage({ entries, walks, coverage, routeViews = [], attrs = ANCHOR_ATTRS }) {
  const failures = []
  const reg = coverage ?? {}
  const cap = reg.capabilities ?? {}
  const pages = reg.pages ?? {}
  const obvious = cap.obvious ?? {}
  const missing = cap.missing ?? {}
  const stepped = new Set(walks.flatMap((w) => (w.steps ?? []).map((s) => s.anchor)))
  const walkSteps = new Map(walks.map((w) => [w.id, new Set((w.steps ?? []).map((s) => s.anchor))]))
  const known = new Set(entries.map((e) => e.anchor))
  const fix = 'Author a walk in tools/walkthrough/walks/ that steps on it, or declare it in tools/walkthrough/coverage.json under capabilities.obvious with one sentence on why nobody needs showing, or under capabilities.missing with a note — in this same change'

  for (const e of entries) {
    const a = e.anchor
    // Naming a walk is a claim, not a clip: the named walk has to STEP this
    // anchor, or the Show-me chip opens a clip that never shows the thing (#860).
    if (e.walk && !walkSteps.has(e.walk)) { failures.push(`CLIPS: ${e.path}:${e.line} — "${e.title}" (${a}) names walk "${e.walk}", which does not exist. Name a walk in tools/walkthrough/walks/ that steps on ${a}, or drop the walk: line`); continue }
    if (e.walk && !walkSteps.get(e.walk).has(a)) { failures.push(`CLIPS: ${e.path}:${e.line} — "${e.title}" (${a}) names walk "${e.walk}", but that walk never steps on ${a}. Add a step on it, or name the walk that does, or drop the walk: line`); continue }
    if (stepped.has(a)) continue
    if (a in obvious || a in missing) continue
    failures.push(`CLIPS: ${e.path}:${e.line} — "${e.title}" (${a}) has no walkthrough and no coverage entry. ${fix}`)
  }
  for (const [a, why] of Object.entries(obvious)) {
    if (!known.has(a)) failures.push(`CLIPS: coverage.json capabilities.obvious names "${a}", which is no longer a capability — remove it`)
    else if (stepped.has(a)) failures.push(`CLIPS: coverage.json capabilities.obvious names "${a}", but a walk now steps on it — remove the line`)
    if (typeof why !== 'string' || why.trim().length < 12) failures.push(`CLIPS: coverage.json capabilities.obvious "${a}" needs a sentence saying why nobody needs showing`)
  }
  for (const [a, note] of Object.entries(missing)) {
    if (!known.has(a)) failures.push(`CLIPS: coverage.json capabilities.missing names "${a}", which is no longer a capability — remove it`)
    else if (stepped.has(a)) failures.push(`CLIPS: coverage.json capabilities.missing names "${a}", but a walk now steps on it — remove the line, the debt is paid`)
    if (typeof note !== 'string' || !note.trim()) failures.push(`CLIPS: coverage.json capabilities.missing "${a}" needs a note`)
  }

  const pObvious = pages.obvious ?? {}
  const pMissing = pages.missing ?? {}
  const viewPaths = new Set(routeViews.map((v) => v.path))
  for (const v of routeViews) {
    const anchored = hasAnchor(v.src, attrs) || v.children.some((c) => hasAnchor(c.src, attrs))
    if (anchored) continue
    if (v.path in pObvious || v.path in pMissing) continue
    failures.push(`CLIPS: ${v.path} is a routed page with no data-walk anchor on it or on anything it imports. Anchor its first capability and describe it, or declare the page in tools/walkthrough/coverage.json under pages.obvious or pages.missing — in this same change`)
  }
  for (const p of [...Object.keys(pObvious), ...Object.keys(pMissing)]) {
    if (!viewPaths.has(p)) failures.push(`CLIPS: coverage.json pages names "${p}", which the router no longer imports — remove it`)
    else {
      const v = routeViews.find((x) => x.path === p)
      if (hasAnchor(v.src, attrs) || v.children.some((c) => hasAnchor(c.src, attrs))) failures.push(`CLIPS: coverage.json pages names "${p}", but it now carries an anchor — remove the line`)
    }
  }
  return { failures }
}

// ---------------------------------------------------------------------------
// Gate 14 — every walk's place has a CLAIMER on the page it lands on (job #881,
// 2026-09-15). The Handbook's "Show me" defers the walk and navigates to the
// walk's place (PLACE_LINKS in handbook.ts); the walk only ever starts when a
// mount on that page calls claimDeferredWalk for that place — today that is
// <HowThisWorks place="…"> or <WalkOffer place="…">. Two workers (#862, #872)
// found five schools routes mounting neither, so every tap there landed
// silently. This gate derives place → URL from handbook.ts, URL → view from
// the router, and view → claimer from the view's transitive .vue imports, so
// the next unclaimed place fails the build instead of a teacher's afternoon.
// ---------------------------------------------------------------------------

/** Minimal JS/TS tokeniser: strings, template literals, identifiers, punctuation; comments dropped. */
export function tokenise(src) {
  const out = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue }
    if (/\s/.test(c)) { i++; continue }
    if (c === "'" || c === '"') {
      let j = i + 1, s = ''
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2 } else s += src[j++] }
      out.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (c === '`') {
      // Template literal: `${expr}` becomes a ':param' segment so a route built
      // as `/org/${node}` resolves the same way as a router ':id' pattern.
      let j = i + 1, s = '', depth = 0
      while (j < n) {
        if (depth === 0 && src[j] === '`') break
        if (src[j] === '$' && src[j + 1] === '{') { depth++; s += ':param'; j += 2; continue }
        if (depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; continue }
        s += src[j++]
      }
      out.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue }
    if (src.startsWith('...', i)) { out.push({ t: 'p', v: '...' }); i += 3; continue }
    if (src.startsWith('=>', i)) { out.push({ t: 'p', v: '=>' }); i += 2; continue }
    out.push({ t: 'p', v: c }); i++
  }
  return out
}

const CLOSE = { '{': '}', '[': ']', '(': ')' }

/** Parse one value starting at tokens[i]; returns { kind, obj|arr|str|raw, nested, end }. */
function parseValue(tok, i) {
  const t = tok[i]
  if (!t) return { kind: 'expr', raw: [], nested: [], end: i }
  if (t.t === 'str') return { kind: 'str', str: t.v, raw: [t], nested: [], end: i + 1 }
  if (t.t === 'p' && t.v === '{') {
    const obj = {}; let j = i + 1
    while (j < tok.length && tok[j].v !== '}') {
      if (tok[j].t === 'p' && (tok[j].v === ',' || tok[j].v === ';')) { j++; continue }
      if (tok[j].t === 'p' && tok[j].v === '...') { const v = parseValue(tok, j + 1); (obj.__spread ??= []).push(v); j = v.end; continue }
      const key = tok[j].v
      if (tok[j + 1]?.v === ':') { const v = parseValue(tok, j + 2); obj[key] = v; j = v.end }
      else { const v = parseExpr(tok, j); j = v.end }
    }
    const nested = Object.values(obj).flatMap((v) => (Array.isArray(v) ? v : [v])).flatMap((v) => (v.kind === 'object' ? [v] : v.nested))
    return { kind: 'object', obj, raw: tok.slice(i, j + 1), nested, end: j + 1 }
  }
  if (t.t === 'p' && t.v === '[') {
    const arr = []; let j = i + 1
    while (j < tok.length && tok[j].v !== ']') {
      if (tok[j].t === 'p' && tok[j].v === ',') { j++; continue }
      const v = tok[j].v === '...' ? parseExpr(tok, j + 1) : parseValue(tok, j)
      arr.push(v); j = v.end
    }
    const nested = arr.flatMap((v) => (v.kind === 'object' ? [v] : v.nested))
    return { kind: 'array', arr, raw: tok.slice(i, j + 1), nested, end: j + 1 }
  }
  return parseExpr(tok, i)
}

/** An expression value: tokens up to the next ',' / closer at depth 0; object literals inside are kept as `nested`. */
function parseExpr(tok, i) {
  const raw = []; const nested = []; let j = i
  while (j < tok.length) {
    const t = tok[j]
    if (t.t === 'p' && (t.v === ',' || t.v === '}' || t.v === ']' || t.v === ')' || t.v === ';')) break
    if (t.t === 'p' && t.v === '{') { const v = parseValue(tok, j); nested.push(v, ...v.nested); raw.push(...v.raw); j = v.end; continue }
    if (t.t === 'p' && (t.v === '[' || t.v === '(')) {
      // Balanced skip, collecting any object literal found inside (a
      // `.map((q) => ({ path: q.slug, component: … }))` child is a route).
      let depth = 0
      while (j < tok.length) {
        const u = tok[j]
        if (u.t === 'p' && CLOSE[u.v]) depth++
        else if (u.t === 'p' && (u.v === '}' || u.v === ']' || u.v === ')')) depth--
        if (u.t === 'p' && u.v === '{' && depth > 0) { const v = parseValue(tok, j); nested.push(v, ...v.nested); raw.push(...v.raw); j = v.end; depth--; continue }
        raw.push(u); j++
        if (depth === 0) break
      }
      continue
    }
    raw.push(t); j++
  }
  return { kind: 'expr', raw, nested, end: j }
}

const importsIn = (raw) => raw.flatMap((t, k) => (t.t === 'id' && t.v === 'import' && raw[k + 1]?.v === '(' && raw[k + 2]?.t === 'str' ? [raw[k + 2].v] : []))

/**
 * The router's flat route table: [{ path, components: [import specs], redirect }].
 * A route whose path is not a string literal (a `.map` over a question list)
 * gets '*' — one wildcard segment — and its component resolves to every
 * import its expression can reach, so a dynamic surface is judged by the set
 * of pages it can show.
 */
export function routeTableFrom(routerSrc) {
  const tok = tokenise(routerSrc)
  // const NAME = <value> — a lazy view import, or a table of them (INTEL_VIEWS).
  const consts = new Map()
  for (let i = 0; i < tok.length; i++) {
    if (tok[i].t === 'id' && tok[i].v === 'const' && tok[i + 1]?.t === 'id') {
      let j = i + 2
      while (j < tok.length && tok[j].v !== '=' && tok[j].v !== ';') j++
      if (tok[j]?.v !== '=') continue
      // The file has no semicolons, so a declaration ends where the next
      // top-level statement keyword begins at bracket depth 0.
      const STOP = new Set(['const', 'let', 'var', 'export', 'function', 'type', 'interface'])
      let k = j + 1, depth = 0
      for (; k < tok.length; k++) {
        const u = tok[k]
        if (u.t === 'p' && CLOSE[u.v]) depth++
        else if (u.t === 'p' && (u.v === '}' || u.v === ']' || u.v === ')')) depth--
        else if (depth === 0 && u.t === 'id' && STOP.has(u.v)) break
      }
      consts.set(tok[i + 1].v, importsIn(tok.slice(j + 1, k)))
    }
  }
  const compsOf = (v) => {
    if (!v) return []
    const direct = importsIn(v.raw)
    const ids = v.raw.filter((t) => t.t === 'id' && consts.has(t.v)).flatMap((t) => consts.get(t.v))
    return [...new Set([...direct, ...ids])]
  }
  const redirectOf = (v) => {
    if (!v) return null
    if (v.kind === 'str') return v.str
    if (v.kind === 'object') return v.obj.path?.kind === 'str' ? v.obj.path.str : null
    const s = v.raw.find((t) => t.t === 'str') ?? v.nested.flatMap((o) => o.obj?.path ? [o.obj.path] : []).find((p) => p.kind === 'str')
    return s ? s.v ?? s.str : null
  }
  const table = []
  const join = (a, b) => (b.startsWith('/') ? b : `${a.replace(/\/$/, '')}/${b}`).replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/'
  const visit = (route, base) => {
    if (route.kind !== 'object' || !route.obj.path) return
    const p = route.obj.path.kind === 'str' ? route.obj.path.str : '*'
    const path = join(base, p)
    table.push({ path, components: compsOf(route.obj.component), redirect: redirectOf(route.obj.redirect) })
    const kids = route.obj.children
    if (kids) for (const k of kids.kind === 'array' ? kids.arr : [kids]) {
      if (k.kind === 'object') visit(k, path)
      else for (const o of k.nested) if (o.obj?.path) visit(o, path)
    }
  }
  // `const routes: RouteRecordRaw[] = [` — the type annotation carries its own
  // `[]`, so seek the `=` first and only then the array.
  const at = tok.findIndex((t, k) => t.t === 'id' && t.v === 'const' && tok[k + 1]?.t === 'id' && tok[k + 1].v === 'routes')
  if (at < 0) return table
  let j = at
  while (j < tok.length && tok[j].v !== '=') j++
  while (j < tok.length && tok[j].v !== '[') j++
  const root = parseValue(tok, j)
  for (const r of root.arr ?? []) { if (r.kind === 'object') visit(r, '/'); else for (const o of r.nested) if (o.obj?.path) visit(o, '/') }
  return table
}

/** Resolve a URL to the route record that renders it, following string redirects. */
export function resolveRoute(table, url, hops = 0) {
  const segs = url.replace(/\?.*$/, '').split('/').filter(Boolean)
  let best = null, bestScore = -1
  for (const r of table) {
    const ps = r.path.split('/').filter(Boolean)
    if (ps.length !== segs.length) continue
    let score = 0, ok = true
    for (let k = 0; k < ps.length; k++) {
      if (ps[k] === segs[k]) score += 2
      else if (ps[k].startsWith(':') || ps[k] === '*') score += 0
      else { ok = false; break }
    }
    // Ties go to the later record: a container's '' child sits after its
    // parent in the table and is the page actually rendered at that URL.
    if (ok && score >= bestScore) { best = r; bestScore = score }
  }
  if (best?.redirect && !best.components.length && hops < 5) return resolveRoute(table, best.redirect, hops + 1)
  return best
}

/** place → URL, read from PLACE_LINKS in handbook.ts. */
export function placeUrlsFrom(handbookSrc) {
  const start = handbookSrc.indexOf('PLACE_LINKS')
  if (start < 0) return {}
  const tok = tokenise(handbookSrc.slice(start))
  let j = 0
  while (j < tok.length && tok[j].v !== '{') j++
  const v = parseValue(tok, j)
  const out = {}
  for (const [k, val] of Object.entries(v.obj ?? {})) {
    if (k === '__spread') continue
    const s = val.raw.find((t) => t.t === 'str' && t.v.startsWith('/'))
    if (s) out[k] = s.v
  }
  return out
}

/** Every .vue file reachable from `path` by `from '…vue'` or `import('…vue')`. */
export function vueImportClosure(path, vueFiles) {
  const byPath = new Map(vueFiles.map((f) => [f.path, f.src]))
  const seen = new Set(); const queue = [path]
  while (queue.length) {
    const p = queue.shift()
    if (seen.has(p)) continue
    seen.add(p)
    const src = byPath.get(p) ?? ''
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)(['"])(@\/[^'"]+\.vue|\.{1,2}\/[^'"]+\.vue)\1/g)) {
      const spec = m[2]
      if (spec.startsWith('@/')) queue.push(`packages/player-vue/src/${spec.slice(2)}`)
      else {
        const parts = p.split('/').slice(0, -1)
        for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg) }
        queue.push(parts.join('/'))
      }
    }
  }
  return [...seen].map((p) => ({ path: p, src: byPath.get(p) ?? '' }))
}

const CLAIMER_COMPONENTS = ['HowThisWorks.vue', 'WalkOffer.vue']

/**
 * Does this file claim the deferred walk for `place`? Either it mounts one of
 * the claimer components with that place (a bound :place passes — the value
 * is the page's to decide), or it calls claimDeferredWalk itself and names
 * the place. HowThisWorks defaults its place to 'node-home' when unset.
 */
export function claimsPlace(src, place) {
  const mounts = []
  for (const c of CLAIMER_COMPONENTS) {
    const im = src.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"][^'"]*/${c.replace('.', '\\.')}['"]`))
    if (!im) continue
    for (const m of src.matchAll(new RegExp(`<${im[1]}\\b([^>]*?)/?>`, 'gs'))) mounts.push({ c, attrs: m[1] })
  }
  for (const { c, attrs } of mounts) {
    const lit = attrs.match(/(?:^|\s)place=(['"])([^'"]*)\1/)
    if (lit) { if (lit[2] === place) return true; continue }
    if (/(?:^|\s)(?::place|v-bind:place)=/.test(attrs)) return true
    if (c === 'HowThisWorks.vue' && place === 'node-home') return true
  }
  if (/claimDeferredWalk\s*\(/.test(src)) {
    for (const m of src.matchAll(/claimDeferredWalk\s*\(([^)]*)\)/g)) {
      const args = m[1].split(',').map((a) => a.trim())
      const p = args[1] ?? ''
      const lit = p.match(/^(['"])([^'"]*)\1$/)
      if (!lit) return true
      if (lit[2] === place) return true
    }
  }
  return false
}

export function gateWalkClaimers({ walks, handbookSrc, routerSrc, vueFiles }) {
  const failures = []
  const urls = placeUrlsFrom(handbookSrc)
  const table = routeTableFrom(routerSrc)
  const byPlace = new Map()
  for (const w of walks) { const p = w.place?.route; if (p) (byPlace.get(p) ?? byPlace.set(p, []).get(p)).push(w.id) }
  for (const [place, ids] of byPlace) {
    const url = urls[place]
    if (!url) { failures.push(`CLAIMER: place "${place}" (walks: ${ids.join(', ')}) has no PLACE_LINKS entry in handbook.ts, so the Handbook's Show me has nowhere to go`); continue }
    const route = resolveRoute(table, url)
    if (!route || !route.components.length) { failures.push(`CLAIMER: place "${place}" links to ${url}, which the router resolves to no component — walks: ${ids.join(', ')}`); continue }
    const toPath = (spec) => (spec.startsWith('@/') ? `packages/player-vue/src/${spec.slice(2)}` : spec)
    // The claimer components claim whatever place their HOST names, so their
    // own dynamic claimDeferredWalk call is never evidence for a page.
    const isClaimerFile = (f) => CLAIMER_COMPONENTS.some((c) => f.path.endsWith('/' + c))
    const pageClaims = (spec) => vueImportClosure(toPath(spec), vueFiles).some((f) => !isClaimerFile(f) && claimsPlace(f.src, place))
    if (route.components.some(pageClaims)) continue
    // A place whose link lands one hop short — class-detail links to the class
    // LIST because the Handbook has no class id — is claimed by the page routed
    // beneath that URL; the deferred walk waits through the hop (job #302).
    const beneath = table.filter((r) => r.path.startsWith(url.replace(/\/$/, '') + '/') && r.components.length)
    if (beneath.some((r) => r.components.some(pageClaims))) continue
    const views = route.components.map(toPath)
    failures.push(
      `CLAIMER: place "${place}" links to ${url} → ${views.join(' | ')}, and nothing that view mounts claims a deferred walk for "${place}". ` +
      `Handbook Show me on ${ids.join(', ')} would navigate there and never start. ` +
      `Mount <HowThisWorks … place="${place}"> or <WalkOffer … place="${place}"> on that view, the way ClassDetail.vue and NodeHomeView.vue do`,
    )
  }
  return { failures }
}
