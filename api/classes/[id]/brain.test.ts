/**
 * Job #128. The diary is capped — 12 pages of 1,000 — and the deepest real
 * class carries 30,482 rows. Which END the cap takes is the whole question:
 * reading oldest-first kept the class's first fortnight and threw away where
 * it is NOW, so the Course journey card drew a frontier the class had left
 * behind months ago. It reads newest-first and hands the rows back in time
 * order, so the cap costs the past and never the frontier.
 */
import { describe, it, expect } from 'vitest'
import { readDiary } from './brain'

const DAY = 86_400_000
const START = Date.parse('2026-06-01T09:00:00.000Z')

/**
 * A 13,000-row diary spread over 13 days, one day per 1,000 rows — more rows
 * than the reader's cap, so something has to give.
 */
function diaryRows(): { event_type: string; occurred_at: string; payload: Record<string, unknown> }[] {
  const rows = []
  for (let i = 0; i < 13_000; i++) {
    rows.push({
      event_type: 'audio_play',
      occurred_at: new Date(START + Math.floor(i / 1000) * DAY + (i % 1000) * 1000).toISOString(),
      payload: { role: 'target1', legoId: `S${String(i % 90 + 1).padStart(4, '0')}L01`, cycleId: `S0001L01_use_01_use_${i}` },
    })
  }
  return rows
}

/** The slice of PostgREST this reader uses, over a fixed set of rows. */
function fakeSvc(all: ReturnType<typeof diaryRows>): any {
  return {
    from: () => {
      let ascending = true
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        gte: () => q,
        order: (_col: string, opts: { ascending: boolean }) => { ascending = opts.ascending; return q },
        range: (from: number, to: number) => {
          const sorted = [...all].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1))
          if (!ascending) sorted.reverse()
          return Promise.resolve({ data: sorted.slice(from, to + 1), error: null })
        },
      }
      return q
    },
  }
}

describe('readDiary', () => {
  it('keeps the newest day when a diary is bigger than the cap', async () => {
    const all = diaryRows()
    const rows = await readDiary(fakeSvc(all), 'learner-1', new Date(START - DAY).toISOString())

    // The cap still bites: 12 pages of 1,000.
    expect(rows.length).toBe(12_000)
    // It bit the PAST. The last day the class played is all there…
    const lastDay = new Date(START + 12 * DAY).toISOString().slice(0, 10)
    expect(rows.filter((r) => r.occurred_at.slice(0, 10) === lastDay).length).toBe(1_000)
    expect(rows[rows.length - 1].occurred_at).toBe(all[all.length - 1].occurred_at)
    // …and it is the FIRST day that gave way.
    const firstDay = new Date(START).toISOString().slice(0, 10)
    expect(rows.some((r) => r.occurred_at.slice(0, 10) === firstDay)).toBe(false)
    // Handed back oldest-first, which is the order the brain reads.
    expect(rows[0].occurred_at < rows[1].occurred_at).toBe(true)
  })

  it('reads a whole short diary, oldest first', async () => {
    const all = diaryRows().slice(0, 300)
    const rows = await readDiary(fakeSvc(all), 'learner-1', new Date(START - DAY).toISOString())
    expect(rows.length).toBe(300)
    expect(rows[0].occurred_at).toBe(all[0].occurred_at)
    expect(rows[299].occurred_at).toBe(all[299].occurred_at)
  })
})
