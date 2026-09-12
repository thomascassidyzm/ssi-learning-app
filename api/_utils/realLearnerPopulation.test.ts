/**
 * The one test the shared population resolver has, per the design's own rule.
 *
 * The case that matters most is the second one: a tester row that
 * test_learner_ids() does not know about must still be excluded. That is the
 * live gap the resolver exists to cover, and it is the failure that would
 * silently inflate every number on every page of the surface.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveRealLearners,
  isMachineCountry,
  MACHINE_COUNTRIES,
  isMachineEvent,
} from './realLearnerPopulation'

type Learner = { id: string; is_class_entity: boolean | null; platform_role: string | null }

function fakeClient(learners: Learner[], testIds: string[], opts: { rosterFails?: boolean } = {}) {
  return {
    rpc: async (name: string) => {
      if (name === 'test_learner_ids') {
        return { data: testIds.map((learner_id) => ({ learner_id })), error: null }
      }
      return { data: null, error: null }
    },
    from: () => ({
      select: async () =>
        opts.rosterFails
          ? { data: null, error: { message: 'boom' } }
          : { data: learners, error: null },
    }),
  } as any
}

describe('resolveRealLearners', () => {
  it('keeps a plain learner and drops everyone the canonical function names', async () => {
    const pop = await resolveRealLearners(
      fakeClient(
        [
          { id: 'real-1', is_class_entity: false, platform_role: null },
          { id: 'demo-1', is_class_entity: false, platform_role: null },
        ],
        ['demo-1'],
      ),
    )
    expect([...pop.realIds]).toEqual(['real-1'])
    expect(pop.excludedIds.has('demo-1')).toBe(true)
    expect(pop.count).toBe(1)
  })

  it('drops a tester the canonical function has never heard of', async () => {
    // The live gap: test_learner_ids() tests is_demo / is_internal / the
    // plus-address / is_test schools, and knows nothing about platform_role.
    // A tester created after the 2026-07 back-fill carries is_internal = false
    // and would otherwise count as a real learner in every number.
    const pop = await resolveRealLearners(
      fakeClient(
        [
          { id: 'real-1', is_class_entity: false, platform_role: null },
          { id: 'tester-1', is_class_entity: false, platform_role: 'tester' },
          { id: 'admin-1', is_class_entity: false, platform_role: 'ssi_admin' },
          { id: 'popty-1', is_class_entity: false, platform_role: 'popty_user' },
        ],
        [], // the canonical function returns nothing at all
      ),
    )
    expect([...pop.realIds]).toEqual(['real-1'])
    expect(pop.count).toBe(1)
  })

  // Tom's ruling, 2026-09-10. A comped teacher, a gifted friend and a pilot
  // school are real humans genuinely learning, and their sessions, weak points
  // and drop-off are true signal. The resolver must have no opinion whatsoever
  // about whether somebody paid — this test is the guard that stops the
  // rejected born-excluded design finding its way back in.
  it('keeps a GIFTED learner: not paying is not the same as not real', async () => {
    const pop = await resolveRealLearners(
      fakeClient(
        [
          { id: 'pays', is_class_entity: false, platform_role: null },
          { id: 'comped', is_class_entity: false, platform_role: null },
          { id: 'pilot', is_class_entity: false, platform_role: null },
        ],
        [],
      ),
    )
    expect(pop.realIds.has('comped')).toBe(true)
    expect(pop.realIds.has('pilot')).toBe(true)
    expect(pop.count).toBe(3)
  })

  it('drops a class entity, which is a room rather than a person', async () => {
    const pop = await resolveRealLearners(
      fakeClient(
        [
          { id: 'real-1', is_class_entity: false, platform_role: null },
          { id: 'class-1', is_class_entity: true, platform_role: null },
        ],
        [],
      ),
    )
    expect([...pop.realIds]).toEqual(['real-1'])
  })

  it('counts nobody rather than everybody when the roster cannot be read', async () => {
    const pop = await resolveRealLearners(fakeClient([], [], { rosterFails: true }))
    expect(pop.count).toBe(0)
  })
})

describe('isMachineCountry', () => {
  it('names Japan and Finland and nothing else', () => {
    expect(MACHINE_COUNTRIES).toEqual(['JP', 'FI'])
    expect(isMachineCountry('JP')).toBe(true)
    expect(isMachineCountry('fi')).toBe(true)
    expect(isMachineCountry('GB')).toBe(false)
    expect(isMachineCountry(null)).toBe(false)
  })
})

describe('isMachineEvent — the country rule never erases a signed-in real learner (job #325)', () => {
  // The 2026-09-12 census found 59 "real learners" whose every production row
  // was stamped JP or FI. Read live: 49 were dangling ids with no learners row,
  // 7 were probe accounts, and 3 were people in Finland with iPhones, one of
  // them 15,706 events deep across twelve courses. A country is not a machine.
  const realIds = new Set(['finnish-human'])
  const svcRow = (learner_id: string | null, ip_country: string | null) => ({ learner_id, ip_country })

  it('keeps a real learner whose rows all come from Finland', () => {
    expect(isMachineEvent(svcRow('finnish-human', 'FI'), realIds)).toBe(false)
    expect(isMachineEvent(svcRow('finnish-human', 'JP'), realIds)).toBe(false)
  })

  it('still drops guest traffic from the machine countries, and rows whose learner id resolves to nobody', () => {
    expect(isMachineEvent(svcRow(null, 'FI'), realIds)).toBe(true)
    expect(isMachineEvent(svcRow('deleted-probe', 'JP'), realIds)).toBe(true)
    expect(isMachineEvent(svcRow(null, 'GB'), realIds)).toBe(false)
  })

  it('reads the learner key from user_id when learner_id is empty, as the census does', () => {
    expect(isMachineEvent({ learner_id: null, user_id: 'finnish-human', ip_country: 'FI' }, realIds)).toBe(false)
  })
})
