/**
 * The funder export's arithmetic, tested against the failure modes Kai named.
 *
 * Kai: "I have some memories of how things have exploded in the past with the
 * old system, so would appreciate running some specific tests on it once it's
 * operational." He has not said what exploded, so these are written against
 * the failure modes that a cohort-reporting system of exactly this shape has:
 * summing the two dialects instead of taking the higher, double-counting or
 * dropping a learner across a month boundary, a person appearing twice, and
 * the roster quietly becoming "people who played" instead of "people who
 * registered".
 *
 * Each test is named for the failure it would catch, not for the function it
 * calls.
 */
import { describe, it, expect } from 'vitest'
import {
  monthWindow,
  fundingYearStart,
  baselineWindow,
  secondsByLearner,
  measureWindow,
  rosterAsAt,
  toCsv,
  type LedgerDay,
  type EnrolledLearner,
} from './orgFunderExport'

const WELSH: Record<string, string> = {
  cym_s_for_eng: 'welsh_south',
  cym_n_for_eng: 'welsh_north',
  cym_nnew_for_eng: 'welsh_north',
}

function learner(id: string, over: Partial<EnrolledLearner> = {}): EnrolledLearner {
  return {
    learner_id: id,
    reporting_from: '2026-09-01',
    enrolled_on: '2026-09-01',
    age_band_16_24: false,
    ...over,
  }
}
function day(learner_id: string, course_code: string, d: string, mins: number): LedgerDay {
  return { learner_id, course_code, day: d, play_seconds: mins * 60 }
}

describe('month windows', () => {
  it('FAILURE MODE: a month boundary that drops or double-counts a day', () => {
    const apr = monthWindow('2026-04')
    const may = monthWindow('2026-05')
    expect(apr.to).toBe('2026-04-30')
    expect(may.from).toBe('2026-05-01')
    // Disjoint and exhaustive: 30 April is in exactly one window, 1 May in
    // exactly one, and there is no day between them belonging to neither.
    expect(apr.to < may.from).toBe(true)
    const nextDay = new Date(`${apr.to}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    expect(nextDay.toISOString().slice(0, 10)).toBe(may.from)
  })

  it('gets February right in a leap year and in an ordinary one', () => {
    expect(monthWindow('2028-02').to).toBe('2028-02-29')
    expect(monthWindow('2026-02').to).toBe('2026-02-28')
  })

  it('refuses a malformed or impossible month rather than guessing', () => {
    expect(() => monthWindow('2026-13')).toThrow()
    expect(() => monthWindow('April')).toThrow()
    expect(() => monthWindow('2026-1')).toThrow()
  })

  it('FAILURE MODE: the April baseline hardcoded to one year', () => {
    // The Welsh funding year runs April to March. A report pulled in February
    // baselines on the PREVIOUS April, not the coming one.
    expect(fundingYearStart(new Date('2027-02-10T00:00:00Z'))).toBe('2026-04-01')
    expect(fundingYearStart(new Date('2026-04-01T00:00:00Z'))).toBe('2026-04-01')
    expect(fundingYearStart(new Date('2026-03-31T00:00:00Z'))).toBe('2025-04-01')
  })
})

describe('the higher of Southern and Northern, never the sum', () => {
  it('FAILURE MODE: a two-dialect learner summed instead of maxed', () => {
    const roster = [learner('a')]
    const ledger = [
      day('a', 'cym_s_for_eng', '2026-09-05', 40),
      day('a', 'cym_n_for_eng', '2026-09-06', 25),
    ]
    const { seconds } = secondsByLearner(ledger, roster, monthWindow('2026-09'), WELSH)
    // 40, not 65. Summing would inflate exactly the most engaged learners.
    expect(seconds.get('a')).toBe(40 * 60)
  })

  it('sums WITHIN a dialect family across days and across course codes', () => {
    const roster = [learner('a')]
    const ledger = [
      day('a', 'cym_n_for_eng', '2026-09-05', 10),
      day('a', 'cym_n_for_eng', '2026-09-06', 12),
      // The Northern rebuild is the same dialect: its minutes must join the
      // Northern total, not stand as a third family that loses the max.
      day('a', 'cym_nnew_for_eng', '2026-09-07', 9),
      day('a', 'cym_s_for_eng', '2026-09-08', 30),
    ]
    const { seconds } = secondsByLearner(ledger, roster, monthWindow('2026-09'), WELSH)
    expect(seconds.get('a')).toBe(31 * 60) // north 10+12+9 = 31 beats south 30
  })

  it('FAILURE MODE: an unrecognised Welsh course code dropped in silence', () => {
    const roster = [learner('a')]
    const ledger = [day('a', 'cym_for_eng_north', '2026-09-05', 50)]
    const { seconds, unmappedCourses } = secondsByLearner(ledger, roster, monthWindow('2026-09'), WELSH)
    expect(seconds.get('a')).toBe(0)
    // It is dropped — but it is REPORTED as dropped, which is the difference
    // between a known gap and a wrong number.
    expect(unmappedCourses).toEqual(['cym_for_eng_north'])
  })
})

describe('the roster is who registered, not who played', () => {
  it('FAILURE MODE: zero-minute learners falling out of the registered count', () => {
    const roster = [learner('played'), learner('never-played')]
    const { result } = measureWindow(
      [day('played', 'cym_s_for_eng', '2026-09-05', 10)],
      roster,
      monthWindow('2026-09'),
      WELSH,
    )
    expect(result.all.registered).toBe(2)
    // The average is over EVERYONE, so the silent half drags it down honestly.
    expect(result.all.averageMinutesAll).toBe(5)
    expect(result.all.averageMinutesOverThree).toBe(10)
    expect(result.all.learnersOverThreeMinutes).toBe(1)
  })

  it('FAILURE MODE: someone counted as registered before they signed up', () => {
    const roster = [
      learner('early', { enrolled_on: '2026-09-10' }),
      learner('late', { enrolled_on: '2026-10-03' }),
    ]
    expect(rosterAsAt(roster, monthWindow('2026-09')).map((r) => r.learner_id)).toEqual(['early'])
    expect(rosterAsAt(roster, monthWindow('2026-10')).map((r) => r.learner_id)).toHaveLength(2)
  })

  it('FAILURE MODE: pre-cutover history leaking into the clean break', () => {
    // The learner played for years before the Canolfan cohort existed. Their
    // ledger rows still exist and are still readable — they are simply out of
    // this cohort's window.
    const roster = [learner('veteran', { reporting_from: '2026-09-01', enrolled_on: '2026-09-01' })]
    const ledger = [
      day('veteran', 'cym_s_for_eng', '2026-08-20', 900),
      day('veteran', 'cym_s_for_eng', '2026-09-02', 12),
    ]
    // Even asking for an all-time window that starts in 2020, the learner's own
    // baseline clamps it.
    const wide = baselineWindow('2020-01-01', '2026-09-30', 'all_time')
    const { seconds } = secondsByLearner(ledger, roster, wide, WELSH)
    expect(seconds.get('veteran')).toBe(12 * 60)
  })
})

describe('thresholds and the 16-24 breakdown', () => {
  it('counts strictly OVER each threshold, never at it', () => {
    const roster = [learner('exactly5'), learner('just-over5')]
    const ledger = [
      { learner_id: 'exactly5', course_code: 'cym_s_for_eng', day: '2026-09-05', play_seconds: 300 },
      { learner_id: 'just-over5', course_code: 'cym_s_for_eng', day: '2026-09-05', play_seconds: 301 },
    ]
    const { result } = measureWindow(ledger, roster, monthWindow('2026-09'), WELSH)
    expect(result.all.overFiveMinutes).toBe(1)
  })

  it('reports 16-24 as a SUBSET of the same figures, never as a separate total', () => {
    const roster = [
      learner('young', { age_band_16_24: true }),
      learner('older'),
    ]
    const ledger = [
      day('young', 'cym_s_for_eng', '2026-09-05', 70),
      day('older', 'cym_s_for_eng', '2026-09-05', 30),
    ]
    const { result } = measureWindow(ledger, roster, monthWindow('2026-09'), WELSH)
    expect(result.all.registered).toBe(2)
    expect(result.all.overSixtyMinutes).toBe(1)
    expect(result.aged16to24.registered).toBe(1)
    expect(result.aged16to24.overSixtyMinutes).toBe(1)
    expect(result.aged16to24.averageMinutesAll).toBe(70)
    // The breakdown is contained by the whole: never larger, on any measure.
    expect(result.aged16to24.registered).toBeLessThanOrEqual(result.all.registered)
    expect(result.aged16to24.totalMinutes).toBeLessThanOrEqual(result.all.totalMinutes)
  })

  it('divides by zero nowhere when nobody has enrolled or nobody has played', () => {
    const empty = measureWindow([], [], monthWindow('2026-09'), WELSH).result
    expect(empty.all.averageMinutesAll).toBe(0)
    expect(empty.all.averageMinutesOverThree).toBe(0)
    const silent = measureWindow([], [learner('a')], monthWindow('2026-09'), WELSH).result
    expect(silent.all.registered).toBe(1)
    expect(silent.all.averageMinutesOverThree).toBe(0)
  })
})

describe('CSV', () => {
  it('emits one all row and one aged_16_24 row per window, and no learner identities', () => {
    const id = '7f3a1c22-9d0e-4b11-8a55-0c2e6d9b4411'
    const roster = [learner(id, { age_band_16_24: true })]
    const { result } = measureWindow([day(id, 'cym_s_for_eng', '2026-09-05', 10)], roster, monthWindow('2026-09'), WELSH)
    const csv = toCsv([result])
    expect(csv.split('\n').filter(Boolean)).toHaveLength(3) // header + 2 cohorts
    expect(csv).toContain('2026-09,all,')
    expect(csv).toContain('2026-09,aged_16_24,')
    // FAILURE MODE: the age tick leaking into something identifiable. The
    // export is counts only — a learner id must never appear in it.
    expect(csv).not.toContain(id)
    // Nothing uuid-shaped anywhere in the file.
    expect(csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(csv).not.toMatch(/@/)
  })
})
