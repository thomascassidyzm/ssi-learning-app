/**
 * Merge/alias audit record + undo plan — model §9
 * (docs/identity/india-identity-model-2026-09-03.md) as pure functions, so
 * the eventual endpoints are thin and the shape is testable with no DB.
 *
 * The bar the model sets (and the brief demanded): a wrong merge must be
 * DETECTABLE without a human complaining and UNDOABLE by a named operation.
 * Confidence is not the deliverable; this record and its derived plan are.
 *
 *   buildMergeRecord() — snapshots BOTH sides in full before anything moves.
 *                        Every merge is attributable (initiatedBy = the
 *                        session that tapped the offer) and carries its
 *                        evidence and its entitlement-union assertion (I4).
 *   deriveUndoPlan()   — the undo's shopping list, derived purely from a
 *                        record: re-point every moved row back BY RECORDED
 *                        ID (never re-derived), restore the absorbed
 *                        learner, restore the verified_emails partition.
 *                        Post-merge accrual stays with whoever did it — the
 *                        record's timestamp is the cut (§6.8).
 *
 * Persistence target: supabase/migrations/20260903_identity_merges.sql
 * (GATED — parked, not applied). Until that is deliberately applied, these
 * shapes are the contract, not the storage.
 */

export type MergeKind = 'alias' | 'two_sided_alias' | 'merge' | 'legacy_land'

export interface IdentitySnapshot {
  learnerId: string | null
  authUserIds: string[]
  verifiedEmails: string[]
  anonId: string | null
  /** RevenueCat app_user_id — 'anon:<uuid>' or 'learner:<id>' (model §7). */
  appUserId: string | null
  entitlements: string[]
  displayName: string | null
}

export interface MovedRows {
  /** table name → row ids re-pointed from the absorbed side to the survivor. */
  [table: string]: string[]
}

export interface MergeEvidence {
  /** Which door proved what, e.g. 'otp:ravi@gmail.com', 'google:ravi@gmail.com'. */
  door: string
  /** ISO timestamp of the explicit accepted offer, if the kind requires one. */
  offerAcceptedAt: string | null
  /** Optional corroboration: apple sub match, support ticket ref, etc. */
  notes: string[]
}

export interface MergeRecord {
  kind: MergeKind
  createdAt: string
  /** auth uid of the session that performed the act — attributability (D9). */
  initiatedBy: string
  fromIdentity: IdentitySnapshot
  toLearnerId: string
  movedRows: MovedRows
  evidence: MergeEvidence
  /** I4 — asserted at merge time, re-checked by the conservation tripwire. */
  entitlementUnion: string[]
  undoneAt: string | null
  undoneBy: string | null
}

export class MergeAuditError extends Error {}

/**
 * Build the audit record for an alias/merge BEFORE anything moves. Throws
 * rather than building a record that could not be undone — an unbuildable
 * record means the operation must not run.
 */
export function buildMergeRecord(params: {
  kind: MergeKind
  initiatedBy: string
  from: IdentitySnapshot
  toLearnerId: string
  toEntitlements: string[]
  movedRows: MovedRows
  evidence: MergeEvidence
  now?: Date
}): MergeRecord {
  const { kind, initiatedBy, from, toLearnerId, toEntitlements, movedRows, evidence } = params

  if (!initiatedBy) throw new MergeAuditError('merge must be attributable: initiatedBy is required')
  if (!toLearnerId) throw new MergeAuditError('no surviving learner id')

  // A named-account merge and a two-sided alias are only ever performed on an
  // explicit accepted offer (model D9 / §6.6) — the tap is what makes the act
  // attributable, and attributable is what a detector needs.
  if ((kind === 'merge' || kind === 'two_sided_alias') && !evidence.offerAcceptedAt) {
    throw new MergeAuditError(`${kind} requires an explicit accepted offer (evidence.offerAcceptedAt)`)
  }

  // A merge absorbs a NAMED account; an alias absorbs an anon id. Refuse a
  // record whose snapshot contradicts its kind — the blur between the two is
  // exactly what D9 forbids.
  if (kind === 'merge' && from.verifiedEmails.length === 0) {
    throw new MergeAuditError('merge of an unnamed identity — that is an alias, record it as one')
  }
  if ((kind === 'alias' || kind === 'two_sided_alias') && !from.anonId) {
    throw new MergeAuditError('alias record with no anon id on the absorbed side')
  }
  if (from.learnerId && from.learnerId === toLearnerId) {
    throw new MergeAuditError('cannot merge an identity into itself')
  }

  const union = Array.from(new Set([...from.entitlements, ...toEntitlements])).sort()

  return {
    kind,
    createdAt: (params.now ?? new Date()).toISOString(),
    initiatedBy,
    fromIdentity: { ...from, authUserIds: [...from.authUserIds], verifiedEmails: [...from.verifiedEmails], entitlements: [...from.entitlements] },
    toLearnerId,
    movedRows: Object.fromEntries(Object.entries(movedRows).map(([t, ids]) => [t, [...ids]])),
    evidence: { ...evidence, notes: [...evidence.notes] },
    entitlementUnion: union,
    undoneAt: null,
    undoneBy: null,
  }
}

export interface UndoStep {
  op: 'restore_learner' | 'repoint_rows' | 'restore_verified_emails' | 'restore_auth_link'
  table?: string
  rowIds?: string[]
  detail: string
}

export interface UndoPlan {
  steps: UndoStep[]
  /** What the undo does NOT restore, stated rather than implied (§6.8). */
  notRestored: string[]
}

/**
 * Derive the named undo operation's plan from a record. Pure: the executing
 * endpoint walks the steps inside one transaction and writes its own audit
 * row (undo is append-only history, never delete).
 */
export function deriveUndoPlan(record: MergeRecord): UndoPlan {
  if (record.undoneAt) throw new MergeAuditError('already undone')

  const steps: UndoStep[] = []

  if (record.fromIdentity.learnerId) {
    steps.push({
      op: 'restore_learner',
      detail: `reactivate/recreate learner ${record.fromIdentity.learnerId} from snapshot`,
    })
    if (record.fromIdentity.verifiedEmails.length > 0) {
      steps.push({
        op: 'restore_verified_emails',
        detail: `remove [${record.fromIdentity.verifiedEmails.join(', ')}] from survivor ${record.toLearnerId}; restore onto ${record.fromIdentity.learnerId}`,
      })
    }
    for (const authUserId of record.fromIdentity.authUserIds) {
      steps.push({
        op: 'restore_auth_link',
        detail: `re-point auth uid ${authUserId} back to learner ${record.fromIdentity.learnerId}`,
      })
    }
  }

  for (const [table, rowIds] of Object.entries(record.movedRows)) {
    if (rowIds.length === 0) continue
    steps.push({
      op: 'repoint_rows',
      table,
      rowIds: [...rowIds],
      detail: `re-point ${rowIds.length} ${table} row(s) back by recorded id`,
    })
  }

  return {
    steps,
    notRestored: [
      `activity accrued to ${record.toLearnerId} after ${record.createdAt} stays with it — the record's timestamp is the cut`,
      // D11 made this true by construction: named accounts are never aliased
      // on the vendor side, so both app_user_ids still exist and resolve.
      'vendor-side state: nothing to undo — RevenueCat was never told about named-account merges (D11)',
    ],
  }
}

/**
 * Tripwire 1 (model §9) — dead-side activity. Given the identifiers an
 * incoming event resolved to, and a set of merge records, return the record
 * (if any) whose ABSORBED side the event is animating. A truly-same human
 * never animates the dead side; a wrong merge almost immediately does.
 */
export function detectDeadSideActivity(
  event: { authUserId?: string | null; email?: string | null; appUserId?: string | null; anonId?: string | null },
  records: MergeRecord[],
): MergeRecord | null {
  const email = (event.email || '').trim().toLowerCase()
  for (const r of records) {
    if (r.undoneAt) continue
    const f = r.fromIdentity
    if (event.authUserId && f.authUserIds.includes(event.authUserId)) return r
    if (email && f.verifiedEmails.some((e) => e.toLowerCase() === email)) return r
    if (event.appUserId && f.appUserId && event.appUserId === f.appUserId) return r
    if (event.anonId && f.anonId && event.anonId === f.anonId) return r
  }
  return null
}

/**
 * Tripwire 2 (model §9 / I4) — entitlement conservation. True = violation:
 * the surviving account now resolves to LESS than the union asserted at
 * merge time, i.e. somebody lost a purchase and nobody has noticed yet.
 */
export function violatesEntitlementConservation(
  record: MergeRecord,
  currentEntitlements: string[],
): boolean {
  const now = new Set(currentEntitlements)
  return record.entitlementUnion.some((e) => !now.has(e))
}
