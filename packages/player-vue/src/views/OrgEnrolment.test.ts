/**
 * OrgEnrolment.vue — the learner's side of the funded-cohort door.
 *
 * These are the failure modes Kai named, seen from the screen rather than
 * from the server: that the consent tick actually gates the button, that a
 * paying learner is TOLD and not charged twice in silence, that a person who
 * is already enrolled is told so rather than shown an error, and that every
 * step of the flow actually renders.
 *
 * That last one is here because of a real near-miss during this build: a
 * botched edit truncated the template to its first branch, and typecheck,
 * lint and the i18n gate all passed on the wreckage. Nothing else in the
 * repository would have noticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))
let routeCode = 'CYM-001'
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'org-enrolment', params: { code: routeCode }, query: {} }),
  useRouter: () => ({ push: routerPush }),
}))
vi.mock('../auth/sendSignInCode', () => ({ sendSignInCode: vi.fn(async () => ({ error: null })) }))

import OrgEnrolment from './OrgEnrolment.vue'

const POLICY = {
  found: true,
  orgName: 'Dysgu Cymraeg',
  consentStatement: 'I agree my anonymous usage data is shared with the National Centre for Learning Welsh.',
  askAgeBand: true,
  ageBandLabel: 'I am aged 16 to 24',
  freeMonths: 12,
}

function mountPage(opts: { policy?: any; enrolResponse?: any; signedIn?: boolean } = {}) {
  const posted: any[] = []
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (String(url).startsWith('/api/org/enrol?')) return { json: async () => opts.policy ?? POLICY } as any
    if (String(url) === '/api/org/enrol') {
      posted.push(JSON.parse(init?.body || '{}'))
      return { json: async () => opts.enrolResponse ?? { success: true, alreadyEnrolled: false, orgName: 'Dysgu Cymraeg', freeAccessUntil: '2027-09-08T00:00:00Z', cancellationNeeded: false } } as any
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const wrapper = mount(OrgEnrolment, {
    global: {
      provide: {
        auth: { isAuthenticated: ref(opts.signedIn ?? true) },
        supabase: ref({
          auth: {
            getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
            verifyOtp: vi.fn(async () => ({ error: null })),
          },
        }),
      },
    },
  })
  return { wrapper, posted, fetchMock }
}

const flush = async () => { await nextTick(); await nextTick(); await nextTick() }

/** The page's action button is always the last one on screen. `Array.at` is
 *  outside this package's TS lib target, so index the honest way. */
function lastButton(wrapper: ReturnType<typeof mountPage>['wrapper']) {
  const buttons = wrapper.findAll('button')
  return buttons[buttons.length - 1]
}

beforeEach(() => {
  routeCode = 'CYM-001'
  routerPush.mockClear()
})

describe('every step renders', () => {
  it('walks intro → ticks → done without a blank screen', async () => {
    const { wrapper } = mountPage()
    await flush()
    // Intro names the org and the offer.
    expect(wrapper.text()).toContain('free year')
    expect(wrapper.text()).toContain('Dysgu Cymraeg')

    await wrapper.find('button').trigger('click')
    await flush()
    // Ticks: the age question and the consent statement, verbatim.
    expect(wrapper.text()).toContain('I am aged 16 to 24')
    expect(wrapper.text()).toContain('National Centre for Learning Welsh')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('shows the sign-in step to somebody who is not signed in', async () => {
    const { wrapper } = mountPage({ signedIn: false })
    await flush()
    await wrapper.find('button').trigger('click')
    await flush()
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
  })

  it('says so plainly when the link is not one we know', async () => {
    const { wrapper } = mountPage({ policy: { found: false } })
    await flush()
    expect(wrapper.text()).toContain('did not work')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })
})

describe('the consent tick gates the button', () => {
  it('FAILURE MODE: claiming the free year without agreeing to the data sharing', async () => {
    const { wrapper, posted } = mountPage()
    await flush()
    await wrapper.find('button').trigger('click')
    await flush()

    const claim = lastButton(wrapper)
    expect(claim.attributes('disabled')).toBeDefined()

    // Ticking ONLY the age box does not open it.
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    await flush()
    expect(lastButton(wrapper).attributes('disabled')).toBeDefined()
    expect(posted).toHaveLength(0)

    // The consent box does.
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true)
    await flush()
    expect(lastButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('sends exactly the two ticks and the code, and nothing else', async () => {
    const { wrapper, posted } = mountPage()
    await flush()
    await wrapper.find('button').trigger('click')
    await flush()
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true)
    await flush()
    await lastButton(wrapper).trigger('click')
    await flush()

    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({ code: 'CYM001', ageBand16to24: true, dataSharingConsent: true })
    // No birth date, no age, no name — the tick exists so that none of that
    // is ever collected.
    expect(Object.keys(posted[0])).toHaveLength(3)
  })
})

describe('the paying learner', () => {
  async function claim(enrolResponse: any) {
    const { wrapper } = mountPage({ enrolResponse })
    await flush()
    await wrapper.find('button').trigger('click')
    await flush()
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true)
    await flush()
    await lastButton(wrapper).trigger('click')
    await flush()
    return wrapper
  }

  it('is told their subscription needs cancelling, and that we will not do it', async () => {
    const wrapper = await claim({ success: true, alreadyEnrolled: false, freeAccessUntil: '2027-09-08T00:00:00Z', cancellationNeeded: true, priorPlanName: 'Yearly' })
    expect(wrapper.text()).toContain('Yearly')
    expect(wrapper.text()).toMatch(/we will not cancel it for you/i)
    // And the free-year end date is on the same screen as the warning.
    expect(wrapper.text()).toContain('8 September 2027')
  })

  it('FAILURE MODE: told to cancel a subscription that is not on the account they are looking at', async () => {
    // The live database holds people with two learner records against one
    // email. On the old system the subscription on the OTHER record went
    // unnoticed and is, a year on, still charging them. Saying "cancel your
    // subscription" to somebody staring at an account that has none is how
    // that goes unfixed a second time.
    const wrapper = await claim({ success: true, alreadyEnrolled: false, freeAccessUntil: '2027-09-08T00:00:00Z', cancellationNeeded: true, priorPlanName: 'Yearly', payingOnAnotherAccount: true })
    expect(wrapper.text()).toMatch(/another account with this email/i)
    expect(wrapper.text()).toContain('Yearly')
    expect(wrapper.text()).toMatch(/we will not cancel it for you/i)
  })

  it('a learner with no subscription sees no cancellation notice at all', async () => {
    const wrapper = await claim({ success: true, alreadyEnrolled: false, freeAccessUntil: '2027-09-08T00:00:00Z', cancellationNeeded: false })
    expect(wrapper.text()).not.toMatch(/cancel/i)
    expect(wrapper.text()).toContain('8 September 2027')
  })

  it('somebody already enrolled is welcomed, not shown an error', async () => {
    const wrapper = await claim({ success: true, alreadyEnrolled: true, freeAccessUntil: '2027-05-01T00:00:00Z', cancellationNeeded: false })
    expect(wrapper.text()).toContain('already in')
    expect(wrapper.text()).toContain('1 May 2027')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('a server refusal leaves them on the ticks with the reason, not on a dead end', async () => {
    const wrapper = await claim({ success: false, error: 'We can only give you free access if you agree to the data-sharing statement.' })
    expect(wrapper.find('[role="alert"]').text()).toContain('free access')
    expect(wrapper.findAll('input[type="checkbox"]').length).toBe(2)
  })
})
