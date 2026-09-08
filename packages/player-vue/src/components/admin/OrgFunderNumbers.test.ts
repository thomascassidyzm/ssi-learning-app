/**
 * Tests for OrgFunderNumbers.vue — the funded org's own monthly return.
 *
 * What is pinned here is the promise the panel makes to the funder and to the
 * people counted in it:
 *   · it asks the SAME endpoint an ssi_admin asks, for THIS node, with a month;
 *   · it renders the export's figures, both cohorts, without doing arithmetic
 *     of its own — a funder return computed twice is one that disagrees with
 *     itself;
 *   · the spreadsheet comes from the endpoint's own CSV mode, not from the
 *     numbers on screen;
 *   · a 403 is shown as words rather than as a silent empty panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OrgFunderNumbers from './OrgFunderNumbers.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({ getAuthToken: async () => 'test-token' }),
}))

function measures(over: Partial<Record<string, number>> = {}) {
  return {
    registered: 120,
    overFiveMinutes: 80,
    overSixtyMinutes: 40,
    overHundredMinutes: 20,
    averageMinutesAll: 55.5,
    averageMinutesOverThree: 91.2,
    learnersOverThreeMinutes: 73,
    totalMinutes: 6660,
    ...over,
  }
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    org: 'Y Ganolfan Dysgu Cymraeg Genedlaethol',
    groupId: 'canolfan',
    month: '2026-08',
    baselineFrom: '2026-04-01',
    generatedAt: '2026-09-08T20:00:00.000Z',
    minutesDefinition: 'Minutes in which the app was playing audio to the learner.',
    windows: [
      { window: { from: '2026-08-01', to: '2026-08-31', label: '2026-08' }, all: measures(), aged16to24: measures({ registered: 30 }) },
      { window: { from: '2026-06-01', to: '2026-08-31', label: 'all_time' }, all: measures(), aged16to24: measures({ registered: 30 }) },
      { window: { from: '2026-04-01', to: '2026-08-31', label: 'since_2026-04-01' }, all: measures(), aged16to24: measures({ registered: 30 }) },
    ],
    unmappedCourseCodes: [],
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => report() }) as any)
  vi.stubGlobal('fetch', fetchMock)
})

describe('OrgFunderNumbers', () => {
  it('asks the funder export for THIS node and paints both cohorts', async () => {
    const wrapper = mount(OrgFunderNumbers, { props: { nodeId: 'canolfan', orgName: 'Canolfan' } })
    await flushPromises()

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/org/funder-export')
    expect(url).toContain('groupId=canolfan')
    expect(url).toMatch(/month=\d{4}-\d{2}/)
    // The bearer token is what the server re-checks the caller's scope with,
    // per request — without it the leader is just an anonymous browser.
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer test-token')

    const text = wrapper.text()
    expect(text).toContain('Y Ganolfan Dysgu Cymraeg Genedlaethol')
    expect(text).toContain('Everyone')
    expect(text).toContain('Aged 16 to 24')
    // Three windows, and the figures are the export's own — 120 registered,
    // 30 of them in the age band, unaltered by anything on the client.
    expect(wrapper.findAll('.funder-window')).toHaveLength(3)
    expect(text).toContain('120')
    expect(text).toContain('30')
    expect(text).toContain('6660')
  })

  it('NEVER shows a person: no learner ids, names or per-row detail reach the panel', async () => {
    const wrapper = mount(OrgFunderNumbers, { props: { nodeId: 'canolfan' } })
    await flushPromises()
    // The export deliberately carries no roster; the panel must not invent a
    // place to put one. This is the guard on the reason the age question could
    // be a tick rather than a birth date.
    expect(wrapper.text()).not.toMatch(/learner_id|@|birth/i)
  })

  it('downloads the spreadsheet from the endpoint, not from the numbers on screen', async () => {
    const clickSpy = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:funder')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as any
      if (tag === 'a') el.click = clickSpy
      return el
    })

    const wrapper = mount(OrgFunderNumbers, { props: { nodeId: 'canolfan' } })
    await flushPromises()

    fetchMock.mockImplementation(async () => ({ ok: true, blob: async () => new Blob(['window,cohort\n']) }) as any)
    await wrapper.get('.funder-verb').trigger('click')
    await flushPromises()

    const csvUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0])
    expect(csvUrl).toContain('format=csv')
    expect(csvUrl).toContain('groupId=canolfan')
    expect(clickSpy).toHaveBeenCalled()
  })

  it('says so in words when the server refuses', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'Not your group' }) }) as any)
    const wrapper = mount(OrgFunderNumbers, { props: { nodeId: 'someone-elses' } })
    await flushPromises()
    expect(wrapper.get('.funder-error').text()).toBe('Not your group')
    expect(wrapper.findAll('.funder-window')).toHaveLength(0)
  })

  it('names a course the family map has never heard of rather than dropping it silently', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => report({ unmappedCourseCodes: ['cym_brand_new'] }) }) as any)
    const wrapper = mount(OrgFunderNumbers, { props: { nodeId: 'canolfan' } })
    await flushPromises()
    expect(wrapper.get('.funder-warning').text()).toContain('cym_brand_new')
  })
})
