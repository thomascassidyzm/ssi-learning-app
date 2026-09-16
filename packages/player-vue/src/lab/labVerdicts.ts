/**
 * The display lab's verdict outbox (job #26) — the Zenjin taste-verdict-store
 * shape: WRITE LOCALLY FIRST, then offer to the server, and never clear the
 * local copy until the server has confirmed that id. The server table is
 * keyed on the verdict's own uuid with duplicates ignored, so a retry of one
 * that did land is a no-op. Drained on every visit and after every tap.
 */
export type LabVerdictWord = 'like' | 'unsure' | 'no'

export interface LabVerdict {
  id: string
  madeAt: string
  rendering: string
  verdict: LabVerdictWord
  note: string | null
  entityId: string
  entityLabel: string | null
  compareTo: string
  compareLabel: string | null
  metric: string
  window: string
  weekLabel: string | null
  build: string | null
  /** Exactly the three numbers that were on the tile when the tap happened. */
  screen: Record<string, unknown> | null
}

interface Held {
  verdict: LabVerdict
  synced: boolean
  tries: number
}

const OUTBOX_KEY = 'ssi.insights-lab.outbox'

function readOutbox(): Held[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as Held[]) : []
  } catch {
    return []
  }
}

function writeOutbox(items: Held[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
}

export function newVerdictId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Everything this browser holds, newest first. */
export function heldVerdicts(): Held[] {
  return readOutbox().slice().sort((a, b) => (a.verdict.madeAt < b.verdict.madeAt ? 1 : -1))
}

export function outboxCounts(): { total: number; waiting: number } {
  const all = readOutbox()
  return { total: all.length, waiting: all.filter((h) => !h.synced).length }
}

/** Write locally, then try the server. Returns the counts afterwards. */
export async function recordVerdict(v: LabVerdict, getToken: () => Promise<string | null>): Promise<{ total: number; waiting: number }> {
  const all = readOutbox()
  all.push({ verdict: v, synced: false, tries: 0 })
  writeOutbox(all)
  await drainOutbox(getToken)
  return outboxCounts()
}

/** Offer every unsynced verdict to the server in one POST; mark the ids it confirms. */
export async function drainOutbox(getToken: () => Promise<string | null>): Promise<{ total: number; waiting: number }> {
  const all = readOutbox()
  const pending = all.filter((h) => !h.synced)
  if (pending.length === 0) return outboxCounts()
  try {
    const token = await getToken()
    if (!token) return outboxCounts()
    const resp = await fetch('/api/lab/verdicts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdicts: pending.map((h) => h.verdict) }),
    })
    for (const h of pending) h.tries += 1
    if (resp.ok) {
      const json = (await resp.json()) as { ids?: string[] }
      const confirmed = new Set((json.ids ?? []).map((s) => s.toLowerCase()))
      for (const h of all) if (confirmed.has(h.verdict.id.toLowerCase())) h.synced = true
    }
  } catch {
    // Unreachable server: the verdicts stay in the outbox and are offered again next visit.
  }
  writeOutbox(all)
  return outboxCounts()
}

/** The latest word this browser gave a rendering under exactly this context, if any. */
export function latestFor(key: Pick<LabVerdict, 'rendering' | 'entityId' | 'compareTo' | 'metric' | 'window'>): LabVerdict | null {
  const matches = readOutbox()
    .map((h) => h.verdict)
    .filter((v) => v.rendering === key.rendering && v.entityId === key.entityId && v.compareTo === key.compareTo && v.metric === key.metric && v.window === key.window)
    .sort((a, b) => (a.madeAt < b.madeAt ? 1 : -1))
  return matches[0] ?? null
}
