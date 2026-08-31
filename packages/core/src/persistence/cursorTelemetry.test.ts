/**
 * cursorTelemetry — the non-linear cursor moves must be REPORTED, and
 * reporting must never be able to break the write it is observing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressStore } from './ProgressStore';
import {
  setCursorTelemetrySink,
  reportCursorMove,
  type CursorMoveEvent,
} from './cursorTelemetry';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Awaitable PostgREST-shaped mock. Every builder method returns the same
 * thenable, and awaiting it yields whatever the current queued result is —
 * enough to drive `.update().eq().or().select()` and read what came back.
 */
function createClient(results: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ table: string; payload: unknown; selected: string | null }> = [];
  let queue = [...results];

  const makeChain = (table: string) => {
    const state: { payload: unknown; selected: string | null } = { payload: null, selected: null };
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'or', 'order', 'limit', 'insert', 'delete']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.update = vi.fn((payload: unknown) => { state.payload = payload; return chain; });
    chain.select = vi.fn((cols?: string) => { state.selected = cols ?? '*'; return chain; });
    chain.single = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => unknown) => {
      calls.push({ table, payload: state.payload, selected: state.selected });
      const next = queue.shift() ?? { data: [], error: null };
      return Promise.resolve(resolve(next));
    };
    return chain;
  };

  const client = {
    schema: () => ({ from: (table: string) => makeChain(table) }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('cursorTelemetry sink', () => {
  afterEach(() => setCursorTelemetrySink(null));

  it('is a no-op before a sink is wired', () => {
    setCursorTelemetrySink(null);
    expect(() => reportCursorMove({
      kind: 'explicit_nav', fromLegoId: null, fromRoundIndex: null,
      toLegoId: 'S0001L01', toRoundIndex: 0, moved: true,
    })).not.toThrow();
  });

  it('swallows a throwing sink — telemetry never breaks a progress write', () => {
    setCursorTelemetrySink(() => { throw new Error('sink exploded'); });
    expect(() => reportCursorMove({
      kind: 'explicit_nav', fromLegoId: null, fromRoundIndex: null,
      toLegoId: 'S0001L01', toRoundIndex: 0, moved: true,
    })).not.toThrow();
  });
});

describe('ProgressStore reports non-linear cursor moves', () => {
  let events: CursorMoveEvent[];

  beforeEach(() => {
    events = [];
    setCursorTelemetrySink((e) => events.push(e));
  });
  afterEach(() => setCursorTelemetrySink(null));

  it('setMode ratchet reports from → to, with moved=true when a row was matched', async () => {
    // 1: current_mode update (returns the PRE-RATCHET cursor)
    // 2: infplay_round_index init
    // 3: the ratchet itself (returns the row it moved)
    const { client } = createClient([
      { data: [{ last_completed_lego_id: 'S0013L02', last_completed_round_index: 13 }], error: null },
      { data: [], error: null },
      { data: [{ last_completed_lego_id: 'S0668L04', last_completed_round_index: 13 }], error: null },
    ]);
    const store = new ProgressStore({ client });

    await store.setMode('learner-1', 'deu_for_eng', 'infplay', {
      legoId: 'S0668L04', roundIndex: 1399,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'infplay_ratchet',
      fromLegoId: 'S0013L02',
      fromRoundIndex: 13,
      toLegoId: 'S0668L04',
      moved: true,
    });
  });

  it('reports moved=false when the forward-only filter matched nothing', async () => {
    const { client } = createClient([
      { data: [{ last_completed_lego_id: 'S0668L04', last_completed_round_index: 1399 }], error: null },
      { data: [], error: null },
      { data: [], error: null }, // ratchet was a no-op
    ]);
    const store = new ProgressStore({ client });

    await store.setMode('learner-1', 'deu_for_eng', 'infplay', {
      legoId: 'S0668L04', roundIndex: 1399,
    });

    expect(events[0]).toMatchObject({ kind: 'infplay_ratchet', moved: false });
  });

  it('setMode("main") reports nothing — no cursor moves', async () => {
    const { client } = createClient([{ data: [], error: null }]);
    const store = new ProgressStore({ client });
    await store.setMode('learner-1', 'deu_for_eng', 'main');
    expect(events).toHaveLength(0);
  });

  it('setEnrollmentCursor reports explicit_nav, carrying the caller reason and from', async () => {
    const { client } = createClient([{ data: [], error: null }]);
    const store = new ProgressStore({ client });

    await store.setEnrollmentCursor('learner-1', 'deu_for_eng', 'S0040L01', 40, {
      reason: 'resume_ttl_belt_regression',
      from: { legoId: 'S0090L02', roundIndex: 190 },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'explicit_nav',
      reason: 'resume_ttl_belt_regression',
      fromLegoId: 'S0090L02',
      fromRoundIndex: 190,
      toLegoId: 'S0040L01',
      toRoundIndex: 40,
      moved: true,
    });
  });

  it('a throwing sink does not fail the cursor write', async () => {
    setCursorTelemetrySink(() => { throw new Error('sink exploded'); });
    const { client } = createClient([{ data: [], error: null }]);
    const store = new ProgressStore({ client });
    await expect(
      store.setEnrollmentCursor('learner-1', 'deu_for_eng', 'S0040L01', 40)
    ).resolves.toBeUndefined();
  });
});
