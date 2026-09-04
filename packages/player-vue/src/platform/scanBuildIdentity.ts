/**
 * scanBuildIdentity — a pure scanner that checks the two build identifiers the
 * app compares against each other still come from ONE source.
 *
 * WHY THIS EXISTS. `vite.config.js` derives a single module-scope `buildNumber`
 * and feeds it to two places:
 *
 *   1. `define: { __BUILD_NUMBER__: JSON.stringify(buildNumber) }` — compiled
 *      into SettingsScreen.vue, App.vue, PwaUpdatePrompt.vue and
 *      TesterFeedback.vue. This is the string Tom reads off his screen.
 *   2. the `/version.json` emitter — never precached, fetched at runtime by
 *      `fetchLatestBuildNumber()` in `usePwaUpdate.ts`.
 *
 * `usePwaUpdate` decides "is a genuinely new build live?" by comparing those
 * two STRINGS. That comparison is only meaningful because both sides are the
 * same expression evaluated once. The config's own comment already says so —
 * "Reuses the exact same buildNumber as __BUILD_NUMBER__ so the two are always
 * comparable" — but nothing enforced it. Recompute the value in one place (a
 * second `Date.now()`, a different sha length, an env var read twice) and the
 * update banner starts comparing two strings that were never equal. The
 * failure is SILENT: the banner either never fires or fires forever. That is
 * the same failure class the update-race hotfix `1403ac0e` closed, re-opened
 * from the other end.
 *
 * Proven in both directions by its test: run over the real config expecting
 * zero findings, and fed synthetic forked configs expecting red. A verifier
 * only ever seen green is not a verifier.
 */

export type BuildIdentityFindingKind =
  /** No `__BUILD_NUMBER__` entry found in a `define` block. */
  | 'define-missing'
  /** No `source:` found on the object that emits `version.json`. */
  | 'emitter-missing'
  /** A side is an inline expression, not a reference to a shared binding. */
  | 'inline-expression'
  /** Both sides are bindings, but not the SAME binding. */
  | 'forked'
  /** The shared name has no module-scope declaration in this file. */
  | 'unbound'
  /** version.json's property is not named `buildNumber` (the reader's key). */
  | 'emitter-key'

export interface BuildIdentityFinding {
  kind: BuildIdentityFindingKind
  why: string
}

/** Lines that are prose rather than code. Same rule as scanClientApiCalls. */
function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')
}

function codeLines(content: string): { line: string; index: number }[] {
  return content
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !isCommentLine(line))
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** Strip a trailing comma and surrounding whitespace. */
function tidy(expr: string): string {
  return expr.trim().replace(/,\s*$/, '').trim()
}

/**
 * Reduce an expression to the single identifier it is, or null if it is
 * anything computed. `JSON.stringify(buildNumber)` → `buildNumber`;
 * `Date.now().toString(36)` → null.
 */
function toBinding(expr: string): string | null {
  let e = tidy(expr)
  const stringify = /^JSON\.stringify\(([\s\S]*)\)$/.exec(e)
  if (stringify) e = tidy(stringify[1])
  return IDENTIFIER.test(e) ? e : null
}

/** The `__BUILD_NUMBER__: <expr>` value, as written. */
export function findDefineExpression(content: string): string | null {
  for (const { line } of codeLines(content)) {
    const m = /__BUILD_NUMBER__\s*:\s*(.+)$/.exec(line)
    if (m) return tidy(m[1])
  }
  return null
}

export interface EmitterSource {
  /** The whole `source:` value, as written. */
  raw: string
  /** The property name inside the emitted object, e.g. `buildNumber`. */
  key: string | null
  /** The property's value expression, as written. */
  value: string | null
}

/** The `source:` of the asset whose `fileName` is `version.json`. */
export function findVersionEmitterSource(content: string): EmitterSource | null {
  const lines = codeLines(content)
  const at = lines.findIndex(({ line }) => /fileName\s*:\s*['"`]version\.json['"`]/.test(line))
  if (at === -1) return null
  for (const { line } of lines.slice(at + 1, at + 11)) {
    const m = /^\s*source\s*:\s*(.+)$/.exec(line)
    if (!m) continue
    const raw = tidy(m[1])
    // Unwrap JSON.stringify({ … }) down to the single property inside.
    const stringify = /^JSON\.stringify\(([\s\S]*)\)$/.exec(raw)
    const objectBody = /^\{([\s\S]*)\}$/.exec(tidy(stringify ? stringify[1] : raw))
    if (!objectBody) return { raw, key: null, value: null }
    const body = tidy(objectBody[1])
    const keyed = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(body)
    if (keyed) return { raw, key: keyed[1], value: tidy(keyed[2]) }
    // Shorthand `{ buildNumber }` — the key and the value are one name.
    if (IDENTIFIER.test(body)) return { raw, key: body, value: body }
    return { raw, key: null, value: null }
  }
  return null
}

/** The reader's key: `fetchLatestBuildNumber()` reads `data.buildNumber`. */
const READER_KEY = 'buildNumber'

/**
 * THE CHECK. `__BUILD_NUMBER__` and the `/version.json` emitter must both be
 * plain references to the SAME module-scope binding — so the two strings the
 * update check compares cannot drift apart.
 */
export function findBuildIdentityForks(content: string): BuildIdentityFinding[] {
  const findings: BuildIdentityFinding[] = []
  const defineExpr = findDefineExpression(content)
  const emitter = findVersionEmitterSource(content)

  if (defineExpr === null) {
    findings.push({
      kind: 'define-missing',
      why: 'no `__BUILD_NUMBER__: …` entry found in the config — the Settings build row compiles against it',
    })
  }
  if (emitter === null) {
    findings.push({
      kind: 'emitter-missing',
      why: 'no `source:` found for the asset emitting version.json — usePwaUpdate fetches it to detect a new build',
    })
  }
  if (defineExpr === null || emitter === null) return findings

  if (emitter.key !== READER_KEY) {
    findings.push({
      kind: 'emitter-key',
      why: `version.json emits ${emitter.key ? `\`${emitter.key}\`` : 'no readable property'}, but fetchLatestBuildNumber() reads \`${READER_KEY}\``,
    })
  }

  const defineBinding = toBinding(defineExpr)
  const emitterBinding = emitter.value === null ? null : toBinding(emitter.value)

  if (defineBinding === null) {
    findings.push({
      kind: 'inline-expression',
      why: `__BUILD_NUMBER__ is computed inline (\`${defineExpr}\`) instead of referencing the shared build-number binding — nothing then guarantees version.json holds the same value`,
    })
  }
  if (emitterBinding === null) {
    findings.push({
      kind: 'inline-expression',
      why: `version.json's source is computed inline (\`${emitter.value ?? emitter.raw}\`) instead of referencing the shared build-number binding — nothing then guarantees __BUILD_NUMBER__ holds the same value`,
    })
  }
  if (defineBinding === null || emitterBinding === null) return findings

  if (defineBinding !== emitterBinding) {
    findings.push({
      kind: 'forked',
      why: `__BUILD_NUMBER__ uses \`${defineBinding}\` but version.json uses \`${emitterBinding}\` — usePwaUpdate compares those two strings, so a fork makes the update banner either never fire or fire forever`,
    })
    return findings
  }

  const declared = new RegExp(`^(?:const|let|var)\\s+${defineBinding}\\s*=`, 'm')
  if (!declared.test(content)) {
    findings.push({
      kind: 'unbound',
      why: `\`${defineBinding}\` has no module-scope declaration in this config, so the two consumers may not be reading one value`,
    })
  }
  return findings
}
