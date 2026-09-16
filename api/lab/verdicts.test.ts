import { describe, it, expect } from 'vitest'
import { toRow } from './verdicts'

const good = {
  id: '6f1c2a4e-1b2c-4d3e-8f9a-0b1c2d3e4f5a',
  madeAt: '2026-09-16T20:00:00.000Z',
  rendering: 'anomaly-line',
  verdict: 'like',
  entityId: 'class-1',
  compareTo: 'school-1',
  metric: 'minutes',
  window: 'this_week',
  note: 'the weather one',
}

describe('lab verdict rows', () => {
  it('a well-formed verdict becomes a row stamped with the admin who tapped it', () => {
    const row = toRow(good, 'admin-uid')
    expect(row).toMatchObject({ id: good.id, verdict: 'like', rendering: 'anomaly-line', admin_user_id: 'admin-uid', note: 'the weather one', window_id: 'this_week' })
  })
  it('refuses a verdict word outside like / unsure / no, and a non-uuid id', () => {
    expect(toRow({ ...good, verdict: 'love' }, 'a')).toBeNull()
    expect(toRow({ ...good, id: 'not-a-uuid' }, 'a')).toBeNull()
  })
  it('the note is kept verbatim, never trimmed of meaning', () => {
    const row = toRow({ ...good, note: '  too busy — the line fights the bars  ' }, 'a')
    expect(row?.note).toBe('  too busy — the line fights the bars  ')
  })
})
