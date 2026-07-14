import { describe, it, expect } from 'vitest';
import { LegoMetricsStore } from './LegoMetricsStore';
import { assessLocalDifficulty } from '../learning/localDifficulty';

/**
 * Minimal Supabase client mock: captures the upsert payload/options and serves
 * a canned select result. Models the chain LegoMetricsStore uses:
 *   client.schema(s).from(t).select('*').eq(...).eq(...)   → { data, error }
 *   client.schema(s).from(t).upsert(payload, opts)         → { error }
 */
function mockClient(loadRows: any[]) {
  const capture: { payload?: any[]; opts?: any } = {};
  const selectChain: any = {
    eq() {
      return selectChain;
    },
    then(resolve: (v: any) => void) {
      resolve({ data: loadRows, error: null });
    },
  };
  const table = {
    select() {
      return selectChain;
    },
    upsert(payload: any[], opts: any) {
      capture.payload = payload;
      capture.opts = opts;
      return Promise.resolve({ error: null });
    },
  };
  const client = { schema: () => ({ from: () => table }) } as any;
  return { client, capture };
}

describe('LegoMetricsStore — B4 difficulty series', () => {
  it('loadAll maps the persisted series + rolling mean', async () => {
    const { client } = mockClient([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        mastery_state: 'consolidating',
        consecutive_smooth: 2,
        consecutive_fast: 1,
        n_samples: 0,
        mean_latency_ms: 42.5,
        recent_latency_samples: [40, 41, 45, 44],
        last_seen_at: '2026-06-13T00:00:00Z',
        updated_at: '2026-06-13T00:00:00Z',
      },
    ]);
    const store = new LegoMetricsStore({ client });
    const rows = await store.loadAll('l1', 'cym_for_eng');
    expect(rows[0].recent_latency_samples).toEqual([40, 41, 45, 44]);
    expect(rows[0].mean_latency_ms).toBe(42.5);
  });

  it('loadAll defaults safely when the series column is absent (pre-migration)', async () => {
    const { client } = mockClient([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        mastery_state: 'acquisition',
        consecutive_smooth: 0,
        consecutive_fast: 0,
        n_samples: 0,
        last_seen_at: '2026-06-13T00:00:00Z',
        updated_at: '2026-06-13T00:00:00Z',
        // no mean_latency_ms / recent_latency_samples
      },
    ]);
    const store = new LegoMetricsStore({ client });
    const rows = await store.loadAll('l1', 'cym_for_eng');
    expect(rows[0].recent_latency_samples).toEqual([]);
    expect(rows[0].mean_latency_ms).toBeNull();
  });

  it('upsertSeries writes only the series columns, keyed on (learner, lego)', async () => {
    const { client, capture } = mockClient([]);
    const store = new LegoMetricsStore({ client });
    await store.upsertSeries([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        recent_latency_samples: [40, 41, 45],
        mean_latency_ms: 42,
      },
    ]);
    expect(capture.opts).toEqual({ onConflict: 'learner_id,lego_id' });
    expect(capture.payload).toEqual([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        recent_latency_samples: [40, 41, 45],
        mean_latency_ms: 42,
      },
    ]);
    // critically, it does NOT touch mastery columns
    expect(capture.payload![0]).not.toHaveProperty('mastery_state');
  });

  it('upsertSeries no-ops on empty input', async () => {
    const { client, capture } = mockClient([]);
    const store = new LegoMetricsStore({ client });
    await store.upsertSeries([]);
    expect(capture.payload).toBeUndefined();
  });

  it('loadAll maps evidence_series (WP-4 aggregator snapshot) when present', async () => {
    const { client } = mockClient([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        mastery_state: 'consolidating',
        consecutive_smooth: 2,
        consecutive_fast: 1,
        n_samples: 0,
        mean_latency_ms: null,
        recent_latency_samples: [],
        evidence_series: { values: [0.4, 1.8], x: [10, 20] },
        last_seen_at: '2026-07-14T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      },
    ]);
    const store = new LegoMetricsStore({ client });
    const rows = await store.loadAll('l1', 'cym_for_eng');
    expect(rows[0].evidence_series).toEqual({ values: [0.4, 1.8], x: [10, 20] });
  });

  it('loadAll defaults evidence_series to undefined when the column is absent (pre-migration)', async () => {
    const { client } = mockClient([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        mastery_state: 'acquisition',
        consecutive_smooth: 0,
        consecutive_fast: 0,
        n_samples: 0,
        last_seen_at: '2026-07-14T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      },
    ]);
    const store = new LegoMetricsStore({ client });
    const rows = await store.loadAll('l1', 'cym_for_eng');
    expect(rows[0].evidence_series).toBeUndefined();
  });

  it('upsertEvidenceSeries writes only the evidence_series column, keyed on (learner, lego)', async () => {
    const { client, capture } = mockClient([]);
    const store = new LegoMetricsStore({ client });
    await store.upsertEvidenceSeries([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        evidence_series: { values: [0.3, 1.2], x: [1, 2] },
      },
    ]);
    expect(capture.opts).toEqual({ onConflict: 'learner_id,lego_id' });
    expect(capture.payload).toEqual([
      {
        learner_id: 'l1',
        lego_id: 'S0001L01',
        course_code: 'cym_for_eng',
        evidence_series: { values: [0.3, 1.2], x: [1, 2] },
      },
    ]);
    expect(capture.payload![0]).not.toHaveProperty('mastery_state');
  });

  it('upsertEvidenceSeries no-ops on empty input', async () => {
    const { client, capture } = mockClient([]);
    const store = new LegoMetricsStore({ client });
    await store.upsertEvidenceSeries([]);
    expect(capture.payload).toBeUndefined();
  });

  it('the persisted series is exactly the shape B4 reads — a rising series flags struggling', async () => {
    const { client } = mockClient([
      {
        learner_id: 'l1',
        lego_id: 'S0042L03',
        course_code: 'cym_for_eng',
        mastery_state: 'acquisition',
        consecutive_smooth: 0,
        consecutive_fast: 0,
        n_samples: 0,
        mean_latency_ms: 60,
        // steadily worsening latency → a developing struggle
        recent_latency_samples: [30, 31, 33, 36, 41, 48, 57, 68],
        last_seen_at: '2026-06-13T00:00:00Z',
        updated_at: '2026-06-13T00:00:00Z',
      },
    ]);
    const store = new LegoMetricsStore({ client });
    const rows = await store.loadAll('l1', 'cym_for_eng');

    // The consumer mapping (rows → UnitSeries) is a one-liner; prove it feeds B4.
    const read = assessLocalDifficulty({
      unitId: rows[0].lego_id,
      unitKind: 'lego',
      values: rows[0].recent_latency_samples,
    });
    expect(read.state).toBe('struggling');
    expect(read.curvature).not.toBeNull();
  });
});
