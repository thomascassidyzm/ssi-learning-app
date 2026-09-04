/**
 * podSlate — which rows of a course pod are THE WALK, and which are
 * continuations attached to it. The client-side mirror of the dashboard's
 * `services/shared/canonical-slate.cjs`, applied one layer down: that module
 * governs `canonical_pod_scenarios`, this one governs the per-course table the
 * player actually reads, `listening_pod_sentences`.
 *
 * WHY THIS EXISTS. Tom's rulings, 2026-09-04:
 *   "A pod is A BRANCH POINT WITH ITS CONTINUATIONS ATTACHED, the same
 *    structure as a question and its foils."
 *   "A RECOVERY ATTACHES, IT DOES NOT APPEND."
 *
 * The six CORE recovery halves are second things that can happen at a
 * coordinate CORE already has — the moment a learner is in trouble. They must
 * be reachable AT that moment, and they must not lengthen the walk of a learner
 * who never branches, not by one line. A row carrying `variant_key` is one of
 * those continuations; `attach_sentence_number` is the base sentence, within
 * the row's own scene, that it branches from.
 *
 * THE RULE, deliberately identical to the canonical one:
 *   - a pod that HAS base rows (variant_key null) has a walk — its walk is its
 *     base rows, and a variant row is a continuation attached to a coordinate;
 *   - a pod that is ALL variants has no walk to protect, so every row is served
 *     and behaviour is byte-identical to before this file existed.
 *
 * Today every course pod is a walk and none carries a continuation, so this
 * changes nothing anywhere. It is what makes it safe for one to.
 *
 * SAFETY NET, NOT MECHANISM. Continuations are also given `global_order` out of
 * band (10001+), so a reader that knows nothing about variants sorts them after
 * their scene rather than into it. That is the belt; this file is the braces.
 */

/** The shape this module needs. Any wider row type satisfies it. */
export interface SlateRow {
  scene_number?: number | null
  sentence_number?: number | null
  variant_key?: string | null
  attach_sentence_number?: number | null
}

/** True if this row is part of the pod's linear walk. */
export function isBaseRow(row: SlateRow | null | undefined): boolean {
  return row == null || row.variant_key == null
}

/** True if any row of this pod is a base row — i.e. there is a walk to protect. */
export function hasBaseRows(rows: readonly SlateRow[] | null | undefined): boolean {
  return (rows || []).some(isBaseRow)
}

/**
 * The walk: base rows if the pod has any, otherwise every row.
 * Order is preserved exactly as given — this filters, it never sorts.
 */
export function baseSlate<T extends SlateRow>(rows: readonly T[] | null | undefined): T[] {
  const all = (rows || []) as T[]
  return hasBaseRows(all) ? all.filter(isBaseRow) : all.slice()
}

/** The continuations: the rows baseSlate() excludes. Empty for an all-variant pod. */
export function continuations<T extends SlateRow>(rows: readonly T[] | null | undefined): T[] {
  const all = (rows || []) as T[]
  return hasBaseRows(all) ? all.filter((r) => !isBaseRow(r)) : []
}

/** The key a branch point is looked up by: a scene and a sentence within it. */
export function branchKey(sceneNumber: number, sentenceNumber: number): string {
  return `${sceneNumber}:${sentenceNumber}`
}

/** One continuation flow: every row of it, in order, and where it attaches. */
export interface PodContinuation<T> {
  variantKey: string
  sceneNumber: number
  attachSentenceNumber: number
  rows: T[]
}

/**
 * Index a pod's continuations by the branch point they attach to.
 *
 * THE CAPABILITY, NOT THE POLICY. This says WHERE a recovery can be served and
 * WHAT it is; it says nothing about WHEN a learner should get one — on a wrong
 * answer, on a hesitation, on a tap, always, never. That is a product taste
 * call and it is Tom's, so it is deliberately absent from this file.
 *
 * A branch point can hold more than one flow (CORE scene 22 holds two), so the
 * value is an array, ordered by variant_key for a stable read.
 */
export function continuationsByBranch<T extends SlateRow>(
  rows: readonly T[] | null | undefined,
): Map<string, Array<PodContinuation<T>>> {
  const byFlow = new Map<string, PodContinuation<T>>()
  for (const row of continuations(rows)) {
    const key = String(row.variant_key)
    let flow = byFlow.get(key)
    if (!flow) {
      flow = {
        variantKey: key,
        // null coerces to 0 through Number(), which is finite and would pass the
        // placeability check below — so the absent case is kept as NaN on purpose.
        sceneNumber: row.scene_number == null ? NaN : Number(row.scene_number),
        attachSentenceNumber:
          row.attach_sentence_number == null ? NaN : Number(row.attach_sentence_number),
        rows: [],
      }
      byFlow.set(key, flow)
    }
    flow.rows.push(row)
  }

  const out = new Map<string, Array<PodContinuation<T>>>()
  for (const flow of [...byFlow.values()].sort((a, b) => a.variantKey.localeCompare(b.variantKey))) {
    // A flow with no attach point cannot be placed in the moment, and appending
    // it somewhere plausible is exactly the thing Tom ruled out ("a recovery
    // three scenes later is worth nothing"). So it is dropped, not guessed.
    if (!Number.isFinite(flow.attachSentenceNumber) || !Number.isFinite(flow.sceneNumber)) continue
    flow.rows.sort((a, b) => Number(a.sentence_number) - Number(b.sentence_number))
    const key = branchKey(flow.sceneNumber, flow.attachSentenceNumber)
    const list = out.get(key) || []
    list.push(flow)
    out.set(key, list)
  }
  return out
}
