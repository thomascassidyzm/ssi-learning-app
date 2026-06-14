import { describe, it, expect, vi } from 'vitest'
import resolver from './difficultyTurns'

function mockClient(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => rpcResult) } as any
}

describe('difficultyTurns resolver (metrics B4 / M1)', () => {
  it('surfaces a rising series as struggling (alarm) and drops a flat one', async () => {
    const client = mockClient({
      data: [
        // steadily worsening latency → a developing struggle
        { learner_id: 'L1', learner_name: 'Alice', lego_id: 'S0042L03', course_code: 'cym', recent_latency_samples: [30, 31, 33, 36, 41, 48, 57, 68], last_seen_at: '2026-06-14T00:00:00Z' },
        // flat → steady, not actionable → not in the list
        { learner_id: 'L2', learner_name: 'Bryn', lego_id: 'S0010L01', course_code: 'cym', recent_latency_samples: [50, 49, 50, 51, 50, 49, 50, 50], last_seen_at: '2026-06-14T00:00:00Z' },
      ],
      error: null,
    })
    const out = await resolver(client, { metric: 'difficultyTurns' })
    expect(out.kind).toBe('table')
    const alice = out.rows.find((r) => r.cells.learner === 'Alice')
    expect(alice).toBeTruthy()
    expect(alice!.tone).toBe('alarm')
    expect(String(alice!.cells.signal)).toContain('Struggling')
    expect(out.rows.find((r) => r.cells.learner === 'Bryn')).toBeUndefined()
  })

  it('degrades to a well-formed empty table on RPC error (never throws)', async () => {
    const out = await resolver(mockClient({ data: null, error: { message: 'admin only' } }), { metric: 'difficultyTurns' })
    expect(out.kind).toBe('table')
    expect(out.rows).toEqual([])
    expect(out.columns.length).toBeGreaterThan(0)
  })

  it('returns empty when the RPC yields no rows', async () => {
    const out = await resolver(mockClient({ data: [], error: null }), { metric: 'difficultyTurns' })
    expect(out.rows).toEqual([])
  })
})
