import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  },
  writable: true,
})

function createMockClient(responses: Record<string, any>) {
  let currentTable = ''
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        const resp = responses[currentTable] || { data: [], error: null }
        return (resolve: any) => resolve(resp)
      }
      return vi.fn(() => new Proxy({}, handler))
    }
  }
  return {
    from: vi.fn((table: string) => {
      currentTable = table
      return new Proxy({}, handler)
    })
  } as any
}

describe('useAnalyticsData', () => {
  beforeEach(async () => {
    vi.resetModules()
    Object.keys(store).forEach(k => delete store[k])
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function setup(responses: Record<string, any> = {}, role = 'school_admin') {
    const { setSchoolsClient } = await import('./client')
    setSchoolsClient(createMockClient(responses))
    const { useGodMode } = await import('./useGodMode')
    const gm = useGodMode()
    if (role === 'school_admin') {
      gm.selectUser({
        user_id: 'u-a', learner_id: 'l-a', display_name: 'Admin',
        educational_role: 'school_admin', platform_role: null, school_id: 's1'
      })
    } else if (role === 'govt_admin') {
      gm.selectUser({
        user_id: 'u-g', learner_id: 'l-g', display_name: 'Gov',
        educational_role: 'govt_admin', platform_role: null, region_code: 'WALES'
      })
    }
    const { useAnalyticsData } = await import('./useAnalyticsData')
    return useAnalyticsData()
  }

  // --- fetchDailyActivity ---

  it('fills 30-day gap with zeros', async () => {
    const ad = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      user_tags: { data: [{ user_id: 'su1' }], error: null },
      learners: { data: [{ id: 'l1' }], error: null },
      sessions: { data: [], error: null },
    })
    await ad.fetchDailyActivity()
    expect(ad.dailyActivity.value).toHaveLength(30)
    expect(ad.dailyActivity.value.every(d => d.sessions === 0)).toBe(true)
  })

  it('aggregates sessions by day and deduplicates students', async () => {
    const ad = await setup({
      classes: { data: [{ id: 'c1' }], error: null },
      user_tags: { data: [{ user_id: 'su1' }], error: null },
      learners: { data: [{ id: 'learner-1' }], error: null },
      sessions: { data: [
        { learner_id: 'learner-1', started_at: '2025-06-15T08:00:00Z', duration_seconds: 1800 },
        { learner_id: 'learner-1', started_at: '2025-06-15T14:00:00Z', duration_seconds: 900 },
      ], error: null },
    })
    await ad.fetchDailyActivity()
    const today = ad.dailyActivity.value.find(d => d.date === '2025-06-15')
    expect(today?.sessions).toBe(2)
    expect(today?.practice_minutes).toBe(45) // (1800+900)/60
    expect(today?.active_students).toBe(1) // same learner counted once
  })

  it('returns empty when no classes found', async () => {
    const ad = await setup({
      classes: { data: [], error: null },
    })
    await ad.fetchDailyActivity()
    expect(ad.dailyActivity.value).toEqual([])
  })

  // --- computed totals ---

  it('totalSessions sums all daily sessions', async () => {
    const ad = await setup()
    ad.dailyActivity.value = [
      { date: '2025-06-14', sessions: 5, practice_minutes: 100, active_students: 3 },
      { date: '2025-06-15', sessions: 3, practice_minutes: 60, active_students: 2 },
    ]
    expect(ad.totalSessions.value).toBe(8)
    expect(ad.totalPracticeMinutes.value).toBe(160)
  })

  it('avgDailyActive averages over active days only', async () => {
    const ad = await setup()
    ad.dailyActivity.value = [
      { date: '2025-06-13', sessions: 0, practice_minutes: 0, active_students: 0 },
      { date: '2025-06-14', sessions: 5, practice_minutes: 100, active_students: 10 },
      { date: '2025-06-15', sessions: 3, practice_minutes: 60, active_students: 6 },
    ]
    expect(ad.avgDailyActive.value).toBe(8) // (10+6)/2
  })

  it('avgDailyActive returns 0 when no active days', async () => {
    const ad = await setup()
    ad.dailyActivity.value = [
      { date: '2025-06-15', sessions: 0, practice_minutes: 0, active_students: 0 },
    ]
    expect(ad.avgDailyActive.value).toBe(0)
  })

  // --- fetchClassRankings ---

  it('ranks classes by avg_seeds descending', async () => {
    const ad = await setup({
      class_student_progress: { data: [
        { class_id: 'c1', class_name: 'Alpha', seeds_completed: 100, total_practice_seconds: 3600 },
        { class_id: 'c1', class_name: 'Alpha', seeds_completed: 50, total_practice_seconds: 1800 },
        { class_id: 'c2', class_name: 'Beta', seeds_completed: 200, total_practice_seconds: 7200 },
      ], error: null },
    })
    await ad.fetchClassRankings()
    expect(ad.classRankings.value).toHaveLength(2)
    // Beta: avg 200/1=200, Alpha: avg 150/2=75
    expect(ad.classRankings.value[0].class_name).toBe('Beta')
    expect(ad.classRankings.value[0].rank).toBe(1)
    expect(ad.classRankings.value[1].rank).toBe(2)
  })

  // --- getSchoolReport ---

  it('returns school report with regional comparison', async () => {
    const ad = await setup({
      class_activity_stats: { data: [
        { class_id: 'c1', class_name: 'A', course_code: 'cym', total_cycles: 300, avg_cycles_per_session: 15, active_students: 10, school_id: 's1', region_code: 'WALES' },
        { class_id: 'c2', class_name: 'B', course_code: 'cym', total_cycles: 200, avg_cycles_per_session: 10, active_students: 8, school_id: 's1', region_code: 'WALES' },
      ], error: null },
      demographic_cycle_averages: { data: { level: 'region', group_id: 'WALES', avg_total_cycles: 250, avg_cycles_per_session: 12, class_count: 50 }, error: null },
    })
    const report = await ad.getSchoolReport('s1')
    expect(report?.classes).toHaveLength(2)
    expect(report?.schoolTotal).toBe(500)
    expect(report?.schoolAvgPerClass).toBe(250)
    expect(report?.regionAvg?.avg_total_cycles).toBe(250)
  })

  it('getSchoolReport returns null on error', async () => {
    const ad = await setup({
      class_activity_stats: { data: null, error: { message: 'fail' } },
    })
    const report = await ad.getSchoolReport('s1')
    expect(report).toBeNull()
  })

  // --- getRegionReport ---

  it('returns region report aggregated by school', async () => {
    const ad = await setup({
      class_activity_stats: { data: [
        { class_id: 'c1', class_name: 'A', school_id: 's1', total_cycles: 100, active_students: 5 },
        { class_id: 'c2', class_name: 'B', school_id: 's1', total_cycles: 200, active_students: 10 },
        { class_id: 'c3', class_name: 'C', school_id: 's2', total_cycles: 150, active_students: 8 },
      ], error: null },
      schools: { data: [
        { id: 's1', school_name: 'School One' },
        { id: 's2', school_name: 'School Two' },
      ], error: null },
      demographic_cycle_averages: { data: { level: 'course', avg_total_cycles: 180, class_count: 100 }, error: null },
    }, 'govt_admin')
    const report = await ad.getRegionReport('WALES')
    expect(report?.schools).toHaveLength(2)
    expect(report?.regionTotal).toBe(450)
    expect(report?.allRegionsAvg?.avg_total_cycles).toBe(180)
  })

  it('getRegionReport returns null on error', async () => {
    const ad = await setup({
      class_activity_stats: { data: null, error: { message: 'fail' } },
    }, 'govt_admin')
    const report = await ad.getRegionReport('WALES')
    expect(report).toBeNull()
  })
})
