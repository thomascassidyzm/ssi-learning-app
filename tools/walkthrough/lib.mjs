/**
 * Walkthrough compiler — the PURE validation half (docs/walkthrough-engine-scout.md §3).
 *
 * Walks are hand-authored JSON (tools/walkthrough/walks/*.json — the DECISIONS);
 * this module is the DRIFT GATE between them and the live Vue source: a walk
 * step anchored to an element that no longer exists FAILS THE BUILD, exactly
 * like the explainer pack's gate. Kept pure (no fs) so the gates unit-test
 * with fixtures; compile.mjs is the CLI shell that feeds it real files.
 */

export const PERSONAS = ['admin', 'leader', 'school_admin', 'teacher', 'learner']
export const ADVANCE_KINDS = ['next', 'click', 'visible']

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
  if (!walk.place || typeof walk.place.route !== 'string') at('place.route is required')
  if (walk.place?.kinds && !Array.isArray(walk.place.kinds)) at('place.kinds must be an array')
  if (!Array.isArray(walk.steps) || !walk.steps.length) at('steps[] must be non-empty')
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
    for (const step of walk.steps) {
      referenced.add(step.anchor)
      const sites = anchorTags.get(step.anchor)
      if (!sites) {
        failures.push(`ANCHOR: walk "${walk.id}" step anchor "${step.anchor}" has no data-walk="${step.anchor}" in any .vue source`)
        continue
      }
      if (memberOffered && sites.every(({ tag }) => /v-if="[^"]*!member/.test(tag))) {
        failures.push(`PERSONA: walk "${walk.id}" is offered to member personas but anchor "${step.anchor}" only exists behind an admin-only v-if="!member" guard`)
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
    for (const step of walk.steps) {
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

/** Deterministic pack assembly (version = content hash, stamped by the CLI). */
export function assemblePack(walks) {
  const sorted = [...walks].sort((a, b) => a.id.localeCompare(b.id))
  return { walks: sorted }
}

/** Run every gate; returns { failures, warnings }. */
export function runGates({ walks, vueFiles, runtimeSrc, rulesJson, evaluateRulesSrc }) {
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
  return { failures, warnings }
}
